import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../api/tsuzuku_api.dart';
import 'server_config.dart';

/// The `apiVersion` this app was generated against (`info.version` of api/openapi.yaml).
final int appApiVersion = int.parse(TsuzukuApi.apiVersion);

/// Cloudflare Access turned the request away: a 403, or a redirect to its login page
/// (`*.cloudflareaccess.com`) instead of the server's JSON. On native that means the service token
/// is wrong, expired or rotated; on web, that the browser's Access login ran out.
class AccessRejected implements Exception {
  const AccessRejected();
  @override
  String toString() => 'Cloudflare Access refused the request.';
}

/// Something answered, but not with the JSON the contract describes: a wrong URL, a proxy page.
class NotTsuzuku implements Exception {
  const NotTsuzuku();
  @override
  String toString() => 'That server answered, but not like a Tsuzuku server.';
}

bool _isAccessHost(String host) =>
    host == 'cloudflareaccess.com' || host.endsWith('.cloudflareaccess.com');

/// Turns Access refusals and non-JSON answers into [AccessRejected] and [NotTsuzuku], and tells
/// [onAccessRejected] so the app can show its "token rejected" screen.
class AccessInterceptor extends Interceptor {
  AccessInterceptor({this.onAccessRejected});

  final VoidCallback? onAccessRejected;

  @override
  void onResponse(
    Response<dynamic> response,
    ResponseInterceptorHandler handler,
  ) {
    final json = response.requestOptions.responseType == ResponseType.json;
    final type = response.headers.value(Headers.contentTypeHeader) ?? '';
    if (json && !type.contains('json')) {
      // Followed redirects end on the Access login page; the browser on web follows them itself.
      final error = _isAccessHost(response.realUri.host)
          ? const AccessRejected()
          : const NotTsuzuku();
      return handler.reject(_wrap(response, error), true);
    }
    handler.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    if (err.error is AccessRejected) onAccessRejected?.call();
    if (err.error is AccessRejected || err.error is NotTsuzuku) {
      return handler.next(err);
    }
    final response = err.response;
    if (response != null && isAccessRefusal(response)) {
      onAccessRejected?.call();
      return handler.next(_wrap(response, const AccessRejected()));
    }
    handler.next(err);
  }

  DioException _wrap(Response<dynamic> response, Object error) => DioException(
    requestOptions: response.requestOptions,
    response: response,
    type: DioExceptionType.badResponse,
    error: error,
  );
}

/// A 403, or a redirect whose `Location` is the Access login page.
@visibleForTesting
bool isAccessRefusal(Response<dynamic> response) {
  final status = response.statusCode ?? 0;
  if (status == 403) return true;
  if (status >= 300 && status < 400) {
    final location = response.headers.value('location');
    final host = location == null ? null : Uri.tryParse(location)?.host;
    return host != null && _isAccessHost(host);
  }
  return false;
}

/// The HTTP client for a server: base URL, Access headers, no silent redirects on native.
Dio buildDio(
  ServerConfig config, {
  VoidCallback? onAccessRejected,
  HttpClientAdapter? adapter,
}) {
  final dio = Dio(
    BaseOptions(
      baseUrl: config.baseUrl,
      headers: config.accessHeaders,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 30),
      // A redirect from the API is Access sending us to its login page; keep it visible. The browser
      // follows redirects itself on web.
      followRedirects: false,
    ),
  );
  if (adapter != null) dio.httpClientAdapter = adapter;
  dio.interceptors.add(AccessInterceptor(onAccessRejected: onAccessRejected));
  return dio;
}

/// The outcome of the test call made before a server config is saved.
sealed class ConnectionResult {
  const ConnectionResult();
}

class ConnectionOk extends ConnectionResult {
  const ConnectionOk(this.serverApiVersion);
  final int? serverApiVersion;
}

class ConnectionFailed extends ConnectionResult {
  const ConnectionFailed(this.message, {this.accessRejected = false});
  final String message;
  final bool accessRejected;
}

/// Calls `/api/sources/status` (behind Access, so it proves the token) and `/api/health` (for the
/// version) with [config], without saving anything.
Future<ConnectionResult> testConnection(
  ServerConfig config, {
  HttpClientAdapter? adapter,
}) async {
  final api = TsuzukuApi(buildDio(config, adapter: adapter));
  try {
    await api.sources.getSourcesStatus();
  } catch (e) {
    return ConnectionFailed(
      describeError(e),
      accessRejected: _isAccessError(e),
    );
  }
  try {
    return ConnectionOk((await api.health.getHealth()).apiVersion);
  } catch (_) {
    return const ConnectionOk(null);
  }
}

bool _isAccessError(Object e) => e is DioException && e.error is AccessRejected;

/// A short message for an error from an API call. Never includes headers, so never the token.
String describeError(Object e) {
  if (e is DioException) {
    final error = e.error;
    if (error is AccessRejected) {
      return 'Cloudflare Access refused the service token. Check the client ID and secret, and that '
          'the Access application has a Service Auth policy for this token.';
    }
    if (error is NotTsuzuku) return error.toString();
    switch (e.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.transformTimeout:
        return 'The server did not answer in time.';
      case DioExceptionType.connectionError:
      case DioExceptionType.unknown:
        return 'Could not reach the server. Check the URL and your connection.';
      case DioExceptionType.badCertificate:
        return 'The server\'s certificate is not trusted.';
      case DioExceptionType.badResponse:
        return 'The server answered ${e.response?.statusCode}.';
      case DioExceptionType.cancel:
        return 'Cancelled.';
    }
  }
  if (e is FormatException || e is TypeError || e is ArgumentError) {
    return const NotTsuzuku().toString();
  }
  return 'Something went wrong: $e';
}

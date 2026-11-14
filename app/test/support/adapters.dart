import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';

/// Answers every request with [handler]'s response, as the network would.
class ScriptedAdapter implements HttpClientAdapter {
  ScriptedAdapter(this.handler);

  final ResponseBody Function(RequestOptions options) handler;
  final requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    return handler(options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody jsonBody(Object? body, {int status = 200}) =>
    ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );

ResponseBody htmlBody(String body, {int status = 200}) =>
    ResponseBody.fromString(
      body,
      status,
      headers: {
        Headers.contentTypeHeader: ['text/html; charset=utf-8'],
      },
    );

ResponseBody redirect(String location, {int status = 302}) =>
    ResponseBody.fromString(
      '',
      status,
      headers: {
        'location': [location],
      },
    );

/// Replays the legacy API's recorded answers from `api/fixtures/<scenario>/cases/` (#108, 2.2):
/// a request gets the next unused case with the same method, path and query.
class FixtureAdapter implements HttpClientAdapter {
  FixtureAdapter(String scenario)
    : _cases = [
        for (final dir
            in (Directory('../api/fixtures/$scenario/cases')
                .listSync()
                .whereType<Directory>()
                .toList()
              ..sort((a, b) => a.path.compareTo(b.path))))
          _Case(
            jsonDecode(File('${dir.path}/request.json').readAsStringSync())
                as Map<String, Object?>,
            jsonDecode(File('${dir.path}/response.json').readAsStringSync())
                as Map<String, Object?>,
          ),
      ];

  final List<_Case> _cases;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final uri = options.uri;
    for (final c in _cases) {
      if (c.used || c.request['method'] != options.method) continue;
      final recorded = Uri.parse(c.request['url'] as String);
      if (recorded.path != uri.path || !_sameQuery(recorded, uri)) continue;
      c.used = true;
      final response = c.response;
      return ResponseBody.fromString(
        // "<wall-clock>" marks a time the real clock stamped (api/fixtures/README.md): any date.
        jsonEncode(response['body'])
            .replaceAll('"<wall-clock>"', '"2026-10-09T12:00:00.000Z"'),
        response['status'] as int,
        headers: {
          Headers.contentTypeHeader: [response['contentType'] as String],
        },
      );
    }
    throw StateError('No recorded answer for ${options.method} $uri');
  }

  bool _sameQuery(Uri a, Uri b) {
    final qa = a.queryParameters, qb = b.queryParameters;
    return qa.length == qb.length &&
        qa.entries.every((e) => qb[e.key] == e.value);
  }

  @override
  void close({bool force = false}) {}
}

class _Case {
  _Case(this.request, this.response);
  final Map<String, Object?> request;
  final Map<String, Object?> response;
  bool used = false;
}

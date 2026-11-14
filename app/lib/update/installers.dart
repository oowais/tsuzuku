import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';

import 'release.dart';
import 'signature.dart';

/// Download progress: 0–1, or null while the size is unknown.
typedef OnProgress = void Function(double? progress);

/// Android: Befikr's `Updater.kt` behind the `tsuzuku/updater` channel (`MainActivity.kt`). Downloads
/// the APK with progress and hands it to the system installer, which asks to confirm; Android only
/// installs it over this app when it carries the same signing key.
class AndroidInstaller {
  AndroidInstaller([this._channel = const MethodChannel('tsuzuku/updater')]);

  final MethodChannel _channel;

  /// Returns false when "Install unknown apps" was off: the setting is open now, and the user taps
  /// Update again after allowing it.
  Future<bool> install(String url, OnProgress onProgress) async {
    _channel.setMethodCallHandler((call) async {
      if (call.method != 'progress') return;
      final args = call.arguments as Map;
      final done = (args['done'] as num).toDouble();
      final total = (args['total'] as num).toDouble();
      onProgress(total > 0 ? (done / total).clamp(0, 1) : null);
    });
    try {
      final result = await _channel.invokeMapMethod<String, Object?>(
        'install',
        {'url': url},
      );
      return result?['needsPermission'] != true;
    } on PlatformException catch (e) {
      throw UpdateException(e.message ?? e.code);
    } finally {
      _channel.setMethodCallHandler(null);
    }
  }
}

/// A started Windows install, kept until the next start tells whether it worked.
class WindowsInstall {
  const WindowsInstall({
    required this.version,
    required this.installer,
    required this.log,
  });

  final Version version;
  final String installer, log;

  Map<String, Object?> toJson() => {
    'version': '$version',
    'installer': installer,
    'log': log,
  };

  static WindowsInstall? fromJson(Object? json) {
    if (json is! Map) return null;
    final v = Version.tryParse('${json['version']}');
    final installer = json['installer'], log = json['log'];
    if (v == null || installer is! String || log is! String) return null;
    return WindowsInstall(version: v, installer: installer, log: log);
  }
}

/// Windows: downloads the installer and its `.sig`, checks the ed25519 signature against the key
/// built into the app, and runs Inno Setup silently. The installer closes the app, replaces it and
/// starts the new version (`packaging/windows/tsuzuku.iss`, `/LAUNCH=1`).
class WindowsInstaller {
  WindowsInstaller(this._dio);

  final Dio _dio;

  /// The downloaded installer, verified; it stays in the app's folder until the new version starts.
  Future<WindowsInstall> download(
    LatestRelease release,
    OnProgress onProgress,
  ) async {
    final url = release.assetUrl, sigUrl = release.signatureUrl;
    if (url == null || sigUrl == null) {
      throw const UpdateException('The release has no Windows installer.');
    }
    final dir = Directory(
      '${(await getApplicationSupportDirectory()).path}${Platform.pathSeparator}updates',
    );
    await dir.create(recursive: true);
    final sep = Platform.pathSeparator;
    final file = File('${dir.path}${sep}tsuzuku-setup-${release.version}.exe');
    final log = '${dir.path}${sep}install-${release.version}.log';
    final signature = await _get<String>(sigUrl, ResponseType.plain);
    try {
      await _dio.download(
        url,
        file.path,
        onReceiveProgress: (done, total) =>
            onProgress(total > 0 ? (done / total).clamp(0, 1) : null),
      );
    } on DioException catch (e) {
      throw UpdateException(describeDownloadError(e));
    }
    onProgress(null);
    await verifyInstaller(file, signature);
    return WindowsInstall(
      version: release.version,
      installer: file.path,
      log: log,
    );
  }

  Future<T> _get<T>(String url, ResponseType type) async {
    try {
      return (await _dio.get<T>(url, options: Options(responseType: type))).data
          as T;
    } on DioException catch (e) {
      throw UpdateException(describeDownloadError(e));
    }
  }

  /// Runs the installer silently and quits, so it can replace the app. Throws when it can't start
  /// (the installer stays for "Try again").
  Future<void> run(WindowsInstall install) async {
    try {
      await Process.start(install.installer, [
        '/VERYSILENT',
        '/SUPPRESSMSGBOXES',
        '/NORESTART',
        '/LAUNCH=1',
        '/LOG=${install.log}',
      ], mode: ProcessStartMode.detached);
    } on ProcessException catch (e) {
      throw UpdateException('Could not start the installer: ${e.message}');
    }
    exit(0);
  }
}

/// Throws, and deletes the file, unless [signature] (the `.sig`) signs it.
Future<void> verifyInstaller(File file, String signature) async {
  if (!await verifyUpdateSignature(await file.readAsBytes(), signature)) {
    await file.delete();
    throw const UpdateException(
      'The downloaded installer is not signed with the Tsuzuku key. Not installed.',
    );
  }
}

String describeDownloadError(DioException e) {
  final status = e.response?.statusCode;
  if (status != null) return 'Download failed: HTTP $status.';
  return 'Download failed: no connection.';
}

/// A failed check or install, with a message to show.
class UpdateException implements Exception {
  const UpdateException(this.message);
  final String message;

  @override
  String toString() => message;
}

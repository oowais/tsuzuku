import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'installers.dart';
import 'release.dart';
import 'whats_new.dart';

/// Small string store for the update state (the last check, a started Windows install, the version
/// seen last). Not secret.
abstract interface class UpdateStore {
  Future<String?> read(String key);
  Future<void> write(String key, String? value);
}

class PrefsUpdateStore implements UpdateStore {
  final _prefs = SharedPreferencesAsync();

  @override
  Future<String?> read(String key) => _prefs.getString(key);

  @override
  Future<void> write(String key, String? value) =>
      value == null ? _prefs.remove(key) : _prefs.setString(key, value);
}

/// The platform this build updates on; null on web and anything else.
UpdatePlatform? currentUpdatePlatform() {
  if (kIsWeb) return null;
  if (Platform.isAndroid) return UpdatePlatform.android;
  if (Platform.isWindows) return UpdatePlatform.windows;
  if (Platform.isLinux) return UpdatePlatform.linux;
  return null;
}

/// In-app updates (#108, step 3.3), ported from Befikr's `useUpdate.ts`. Checks GitHub for the newest
/// `app-v*` release at most once a day (or on "Check for updates"); the result is kept so the
/// Settings dot survives restarts. An update counts only once this platform's file is attached;
/// until then it is "being built" and checked every 5 minutes and when the app comes back to the
/// front. Android installs through the system installer, Windows through the signed installer,
/// Linux only says so (Shelly replaces the AppImage). Separate from the `apiVersion` banner.
class UpdateController extends ChangeNotifier {
  UpdateController({
    required this.platform,
    required this.store,
    Dio? dio,
    Future<String> Function()? appVersion,
    AndroidInstaller? android,
    WindowsInstaller? windows,
    DateTime Function()? clock,
  }) : _dio = dio ?? _githubDio(),
       _appVersion = appVersion ?? _packageVersion,
       _clock = clock ?? DateTime.now {
    _android = android ?? AndroidInstaller();
    _windows = windows ?? WindowsInstaller(_dio);
  }

  final UpdatePlatform? platform;
  final UpdateStore store;
  final Dio _dio;
  final Future<String> Function() _appVersion;
  final DateTime Function() _clock;
  late final AndroidInstaller _android;
  late final WindowsInstaller _windows;

  static const latestKey = 'update.latest';
  static const windowsInstallKey = 'update.windowsInstall';
  static const seenKey = 'whatsNew.seenVersion';

  /// This app's version; null until [start] has read it.
  Version? current;
  LatestRelease? latest;
  bool checking = false;
  String? checkError;

  bool installing = false;

  /// Download progress while installing: 0–1, or null while the size is unknown.
  double? progress;
  String? installError;

  /// Android: "Install unknown apps" was opened; tap Update again after allowing it.
  bool needsPermission = false;

  /// Windows: an installer that failed or did not start, kept for "Try again".
  WindowsInstall? failedInstall;

  /// What's new since the version seen last; shown once, then cleared.
  List<ReleaseNotes> whatsNew = const [];

  Timer? _timer;
  AppLifecycleListener? _lifecycle;

  bool get supported => platform != null;

  bool get _newer =>
      current != null && latest != null && latest!.version > current!;

  /// A newer release with this platform's file attached.
  Version? get available => _newer && latest!.ready ? latest!.version : null;

  /// A newer release still waiting for this platform's file.
  Version? get building => _newer && !latest!.ready ? latest!.version : null;

  /// The app can install [available] itself; Linux only shows it.
  bool get canInstall =>
      available != null &&
      latest!.assetUrl != null &&
      (platform == UpdatePlatform.android ||
          platform == UpdatePlatform.windows);

  /// Reads the version and saved state, shows What's new after an update, settles a started Windows
  /// install, and checks when due.
  Future<void> start({bool listenToLifecycle = true}) async {
    current = Version.tryParse(await _appVersion());
    latest = LatestRelease.fromJson(_decode(await store.read(latestKey)));
    await _afterStart();
    notifyListeners();
    if (!supported) return;
    if (listenToLifecycle) {
      _lifecycle = AppLifecycleListener(onResume: check);
    }
    await check();
  }

  Future<void> _afterStart() async {
    final now = current;
    if (now == null) return;
    final seen = Version.tryParse(await store.read(seenKey) ?? '');
    await store.write(seenKey, '$now');
    whatsNew = notesSince(await loadReleaseNotes(), seen, now);

    final started = WindowsInstall.fromJson(
      _decode(await store.read(windowsInstallKey)),
    );
    if (started == null) return;
    if (started.version > now) {
      // The installer ran but this is still the old version.
      failedInstall = started;
      installError =
          'Installing ${started.version} failed.${_logTail(started)}';
    } else {
      await store.write(windowsInstallKey, null);
      for (final path in [started.installer, started.log]) {
        try {
          await File(path).delete();
        } catch (_) {}
      }
    }
  }

  String _logTail(WindowsInstall install) {
    try {
      final lines = File(install.log).readAsLinesSync();
      final tail = lines.skip(lines.length > 6 ? lines.length - 6 : 0);
      return tail.isEmpty ? '' : '\n${tail.join('\n')}';
    } catch (_) {
      return '';
    }
  }

  void clearWhatsNew() {
    whatsNew = const [];
    notifyListeners();
  }

  /// Fetches the newest app release; without [force], only when due ([checkDue]).
  Future<void> check({bool force = false}) async {
    final target = platform;
    if (target == null || checking) return;
    if (!force && !checkDue(latest, current, _clock())) {
      _schedule();
      return;
    }
    checking = true;
    checkError = null;
    notifyListeners();
    try {
      final res = await _dio.get<List<Object?>>(releasesUrl);
      final found = newestAppRelease(res.data ?? const [], target, _clock());
      latest =
          found ??
          LatestRelease(
            version: current ?? const Version(0, 0, 0),
            ready: true,
            checkedAt: _clock(),
          );
      await store.write(latestKey, jsonEncode(latest!.toJson()));
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      checkError = status == null
          ? 'Could not reach GitHub.'
          : 'GitHub answered HTTP $status.';
    } catch (e) {
      checkError = 'Update check failed: $e';
    } finally {
      checking = false;
      notifyListeners();
      _schedule();
    }
  }

  /// While a release is being built: check again in 5 minutes.
  void _schedule() {
    _timer?.cancel();
    _timer = null;
    if (building == null) return;
    _timer = Timer(pendingRecheck, check);
  }

  /// "Update": downloads with progress and installs; the app restarts as the new version.
  Future<void> install() async {
    final release = latest;
    if (!canInstall || installing || release == null) return;
    installing = true;
    progress = null;
    installError = null;
    needsPermission = false;
    notifyListeners();
    void onProgress(double? p) {
      progress = p;
      notifyListeners();
    }

    try {
      if (platform == UpdatePlatform.android) {
        needsPermission = !await _android.install(
          release.assetUrl!,
          onProgress,
        );
      } else {
        final started = await _windows.download(release, onProgress);
        failedInstall = started;
        await _runWindows(started);
      }
    } on UpdateException catch (e) {
      installError = e.message;
    } catch (e) {
      installError = 'Update failed: $e';
    } finally {
      installing = false;
      progress = null;
      notifyListeners();
    }
  }

  /// Windows "Try again": the kept installer, checked again before it runs.
  Future<void> retryWindowsInstall() async {
    final kept = failedInstall;
    if (kept == null || installing) return;
    if (!File(kept.installer).existsSync()) {
      failedInstall = null;
      await store.write(windowsInstallKey, null);
      return install();
    }
    installing = true;
    installError = null;
    notifyListeners();
    try {
      final sig = latest?.signatureUrl;
      if (sig != null && latest?.version == kept.version) {
        final res = await _dio.get<String>(
          sig,
          options: Options(responseType: ResponseType.plain),
        );
        await verifyInstaller(File(kept.installer), res.data ?? '');
      }
      await _runWindows(kept);
    } on UpdateException catch (e) {
      installError = e.message;
    } catch (e) {
      installError = 'Update failed: $e';
    } finally {
      installing = false;
      notifyListeners();
    }
  }

  Future<void> _runWindows(WindowsInstall install) async {
    // Saved first: the next start compares versions and reports a failed install.
    await store.write(windowsInstallKey, jsonEncode(install.toJson()));
    await _windows.run(install);
  }

  @override
  void dispose() {
    _timer?.cancel();
    _lifecycle?.dispose();
    super.dispose();
  }
}

Object? _decode(String? json) {
  if (json == null) return null;
  try {
    return jsonDecode(json);
  } on FormatException {
    return null;
  }
}

Future<String> _packageVersion() async =>
    (await PackageInfo.fromPlatform()).version;

/// A plain client for GitHub: never the server's Dio, so no Access token ever goes to GitHub.
Dio _githubDio() => Dio(
  BaseOptions(
    connectTimeout: const Duration(seconds: 15),
    receiveTimeout: const Duration(minutes: 5),
    headers: {'Accept': 'application/vnd.github+json'},
  ),
);

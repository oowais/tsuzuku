import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import 'api/tsuzuku_api.dart';
import 'server/connection.dart';
import 'server/server_config.dart';

/// App-wide state: which server, the API client for it, the version check, and whether Cloudflare
/// Access has refused us.
class AppController extends ChangeNotifier {
  AppController({required this.store, this.web = kIsWeb, this.adapter});

  final ServerConfigStore store;

  /// The web build: same origin, the browser's Access cookie, no first-run screen.
  final bool web;

  /// For tests: answers HTTP calls instead of the network.
  final HttpClientAdapter? adapter;

  bool loading = true;
  ServerConfig? config;
  TsuzukuApi? api;

  /// The server's `apiVersion` from `/api/health`, once known.
  int? serverApiVersion;

  /// Access answered 403 or redirected to its login page; the app shows the "token rejected" screen.
  bool accessRejected = false;

  /// The first-run screen shows while there is no server config (native only).
  bool get needsSetup => !loading && config == null;

  bool get versionMismatch =>
      serverApiVersion != null && serverApiVersion != appApiVersion;

  /// Secure storage could not be read (no keyring, locked keyring); the first run shows it.
  String? storageError;

  Future<void> load() async {
    try {
      config = web ? const ServerConfig.sameOrigin() : await store.load();
    } catch (e) {
      // Never leave the app on the loading spinner: ask for the server again instead.
      config = null;
      storageError = 'Could not read the saved server settings: $e';
    }
    _connect();
    loading = false;
    notifyListeners();
    if (config != null) await checkVersion();
  }

  /// Stores a config that passed [testConnection].
  Future<void> save(ServerConfig newConfig, {int? serverApiVersion}) async {
    await store.save(newConfig);
    config = newConfig;
    accessRejected = false;
    this.serverApiVersion = serverApiVersion;
    _connect();
    notifyListeners();
    if (serverApiVersion == null) await checkVersion();
  }

  /// Compares the server's `apiVersion` with the one built into the app. `/api/health` needs no
  /// Access token, so this works even while the token is refused.
  Future<void> checkVersion() async {
    final client = api;
    if (client == null) return;
    try {
      serverApiVersion = (await client.health.getHealth()).apiVersion;
      notifyListeners();
    } catch (_) {
      // Unknown until the server answers; the screens show their own errors.
    }
  }

  /// "Retry" on the token-rejected screen.
  Future<void> retry() async {
    final client = api;
    if (client == null) return;
    try {
      await client.sources.getSourcesStatus();
      accessRejected = false;
      notifyListeners();
    } catch (_) {
      // Still refused (the interceptor keeps [accessRejected] set) or unreachable.
    }
  }

  void _connect() {
    final current = config;
    api = current == null
        ? null
        : TsuzukuApi(
            buildDio(
              current,
              onAccessRejected: _onAccessRejected,
              adapter: adapter,
            ),
          );
  }

  void _onAccessRejected() {
    if (accessRejected) return;
    accessRejected = true;
    notifyListeners();
  }
}

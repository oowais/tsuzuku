import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Where the app finds the Tsuzuku server, and the Cloudflare Access service token it sends.
///
/// Native builds store it on the device (first run, then Settings → Server). The web build is served
/// by the server itself: same origin, relative URLs, and the browser's own Access cookie, so it has
/// neither a URL nor a token.
class ServerConfig {
  const ServerConfig({
    required this.baseUrl,
    this.clientId = '',
    this.clientSecret = '',
  });

  /// The web build: relative URLs against the page's own origin.
  const ServerConfig.sameOrigin() : this(baseUrl: '');

  /// `https://tsuzuku.example.com`, without a trailing slash; empty on web.
  final String baseUrl;

  /// `CF-Access-Client-Id`; empty for a server without Access (the local demo).
  final String clientId;

  /// `CF-Access-Client-Secret`. Never logged or shown.
  final String clientSecret;

  bool get hasToken => clientId.isNotEmpty && clientSecret.isNotEmpty;

  /// The Access headers for every request, or none without a token.
  Map<String, String> get accessHeaders => hasToken
      ? {
          'CF-Access-Client-Id': clientId,
          'CF-Access-Client-Secret': clientSecret,
        }
      : const {};
}

/// Checks a server URL typed on the first run or in Settings. Returns the URL to store (scheme and
/// host, any path, no trailing slash), or throws [FormatException] with a message to show.
String normalizeServerUrl(String input) {
  var text = input.trim();
  if (text.isEmpty) throw const FormatException('Enter the server URL.');
  if (!text.contains('://')) text = 'https://$text';
  final uri = Uri.tryParse(text);
  if (uri == null ||
      uri.host.isEmpty ||
      !(uri.scheme == 'https' || uri.scheme == 'http')) {
    throw const FormatException(
      'Enter a URL like https://tsuzuku.example.com.',
    );
  }
  if (uri.hasQuery || uri.hasFragment) {
    throw const FormatException('Leave out the ? and # parts.');
  }
  return uri.toString().replaceAll(RegExp(r'/+$'), '');
}

/// Keeps the [ServerConfig] between runs.
abstract interface class ServerConfigStore {
  Future<ServerConfig?> load();
  Future<void> save(ServerConfig config);
}

/// [ServerConfigStore] in the platform's secure storage (Android Keystore, Windows Credential
/// Manager, libsecret on Linux).
class SecureServerConfigStore implements ServerConfigStore {
  SecureServerConfigStore([this._storage = const FlutterSecureStorage()]);

  final FlutterSecureStorage _storage;

  static const _url = 'server_url';
  static const _id = 'access_client_id';
  static const _secret = 'access_client_secret';

  @override
  Future<ServerConfig?> load() async {
    final url = await _storage.read(key: _url);
    if (url == null || url.isEmpty) return null;
    return ServerConfig(
      baseUrl: url,
      clientId: await _storage.read(key: _id) ?? '',
      clientSecret: await _storage.read(key: _secret) ?? '',
    );
  }

  @override
  Future<void> save(ServerConfig config) async {
    await _storage.write(key: _id, value: config.clientId);
    await _storage.write(key: _secret, value: config.clientSecret);
    // Last, so a half-written config never counts as set up.
    await _storage.write(key: _url, value: config.baseUrl);
  }
}

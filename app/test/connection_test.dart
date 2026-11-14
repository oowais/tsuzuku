import 'package:flutter_test/flutter_test.dart';
import 'package:tsuzuku/server/connection.dart';
import 'package:tsuzuku/server/server_config.dart';

import 'support/adapters.dart';

const _config = ServerConfig(
  baseUrl: 'https://tsuzuku.example.com',
  clientId: 'id.access',
  clientSecret: 'secret',
);

const _status = [
  {
    'source': 'trakt',
    'connected': true,
    'status': null,
    'blockedUntil': null,
    'retryAfter': null,
    'lastFetchAt': null,
    'lastError': null,
  },
];

void main() {
  group('normalizeServerUrl', () {
    test('keeps scheme, host and path, drops the trailing slash', () {
      expect(
        normalizeServerUrl(' https://tsuzuku.example.com/ '),
        'https://tsuzuku.example.com',
      );
      expect(
        normalizeServerUrl('tsuzuku.example.com'),
        'https://tsuzuku.example.com',
      );
      expect(
        normalizeServerUrl('http://localhost:3000'),
        'http://localhost:3000',
      );
      expect(
        normalizeServerUrl('https://example.com/tsuzuku/'),
        'https://example.com/tsuzuku',
      );
    });

    test('refuses what is not a server URL', () {
      for (final bad in [
        '',
        'ftp://example.com',
        'https://',
        'https://example.com/?a=1',
      ]) {
        expect(
          () => normalizeServerUrl(bad),
          throwsFormatException,
          reason: bad,
        );
      }
    });
  });

  group('testConnection', () {
    test('sends the service token and reads the server version', () async {
      final adapter = ScriptedAdapter(
        (o) => o.path == '/api/health'
            ? jsonBody({'ok': true, 'apiVersion': 1})
            : jsonBody(_status),
      );
      final result = await testConnection(_config, adapter: adapter);
      expect(
        result,
        isA<ConnectionOk>().having((r) => r.serverApiVersion, 'apiVersion', 1),
      );
      final status = adapter.requests.first;
      expect(
        status.uri.toString(),
        'https://tsuzuku.example.com/api/sources/status',
      );
      expect(status.headers['CF-Access-Client-Id'], 'id.access');
      expect(status.headers['CF-Access-Client-Secret'], 'secret');
    });

    test('sends no Access headers without a token', () async {
      final adapter = ScriptedAdapter((o) => jsonBody(_status));
      await testConnection(
        const ServerConfig(baseUrl: 'http://localhost:3000'),
        adapter: adapter,
      );
      expect(
        adapter.requests.first.headers.keys,
        isNot(contains('CF-Access-Client-Id')),
      );
    });

    test('a 403 is Access refusing the token', () async {
      final result = await testConnection(
        _config,
        adapter: ScriptedAdapter((o) => htmlBody('Forbidden', status: 403)),
      );
      expect(
        result,
        isA<ConnectionFailed>().having((r) => r.accessRejected, 'access', true),
      );
    });

    test(
      'a redirect to the Access login page is Access refusing the token',
      () async {
        final result = await testConnection(
          _config,
          adapter: ScriptedAdapter(
            (o) => redirect(
              'https://team.cloudflareaccess.com/cdn-cgi/access/login/tsuzuku',
            ),
          ),
        );
        expect(
          result,
          isA<ConnectionFailed>().having(
            (r) => r.accessRejected,
            'access',
            true,
          ),
        );
      },
    );

    test(
      'another redirect or an HTML page is not Tsuzuku, not Access',
      () async {
        for (final body in [
          redirect('https://example.com/elsewhere'),
          htmlBody('<html></html>'),
        ]) {
          final result = await testConnection(
            _config,
            adapter: ScriptedAdapter((o) => body),
          );
          expect(
            result,
            isA<ConnectionFailed>().having(
              (r) => r.accessRejected,
              'access',
              false,
            ),
          );
        }
      },
    );

    test('the error message never contains the secret', () async {
      final result = await testConnection(
        const ServerConfig(
          baseUrl: 'https://t.example.com',
          clientId: 'id',
          clientSecret: 's3cr3t-x',
        ),
        adapter: ScriptedAdapter((o) => htmlBody('Forbidden', status: 403)),
      );
      expect((result as ConnectionFailed).message, isNot(contains('s3cr3t-x')));
    });
  });
}

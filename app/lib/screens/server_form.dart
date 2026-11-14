import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../server/connection.dart';
import '../server/server_config.dart';

/// First run on native: where the server is and the Access service token, tested before saving.
class FirstRunScreen extends StatelessWidget {
  const FirstRunScreen({super.key, required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Connect to your Tsuzuku server')),
      body: ServerForm(controller: controller),
    );
  }
}

/// Settings → Server → Change.
class ServerSettingsScreen extends StatelessWidget {
  const ServerSettingsScreen({super.key, required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Server')),
      body: ServerForm(
        controller: controller,
        onSaved: () => Navigator.of(context).pop(),
      ),
    );
  }
}

/// Server URL plus `CF-Access-Client-Id` and `CF-Access-Client-Secret`. "Test and save" calls
/// `/api/sources/status` with them and stores them only if that works.
class ServerForm extends StatefulWidget {
  const ServerForm({super.key, required this.controller, this.onSaved});

  final AppController controller;
  final VoidCallback? onSaved;

  @override
  State<ServerForm> createState() => _ServerFormState();
}

class _ServerFormState extends State<ServerForm> {
  late final TextEditingController _url;
  late final TextEditingController _id;
  // The stored secret is never put back into the field; empty means "keep the stored one".
  final _secret = TextEditingController();
  bool _busy = false;
  String? _error;

  ServerConfig? get _current => widget.controller.config;

  @override
  void initState() {
    super.initState();
    _url = TextEditingController(text: _current?.baseUrl ?? '');
    _id = TextEditingController(text: _current?.clientId ?? '');
    _error = widget.controller.storageError;
  }

  @override
  void dispose() {
    _url.dispose();
    _id.dispose();
    _secret.dispose();
    super.dispose();
  }

  Future<void> _testAndSave() async {
    final String url;
    try {
      url = normalizeServerUrl(_url.text);
    } on FormatException catch (e) {
      setState(() => _error = e.message);
      return;
    }
    final id = _id.text.trim();
    var secret = _secret.text.trim();
    if (secret.isEmpty && id.isNotEmpty && id == _current?.clientId) {
      secret = _current?.clientSecret ?? '';
    }
    if (id.isEmpty != secret.isEmpty) {
      setState(
        () => _error = 'Enter both the client ID and the secret, or neither.',
      );
      return;
    }

    final config = ServerConfig(
      baseUrl: url,
      clientId: id,
      clientSecret: secret,
    );
    setState(() {
      _busy = true;
      _error = null;
    });
    final result = await testConnection(
      config,
      adapter: widget.controller.adapter,
    );
    if (!mounted) return;
    switch (result) {
      case ConnectionOk(:final serverApiVersion):
        await widget.controller.save(
          config,
          serverApiVersion: serverApiVersion,
        );
        if (!mounted) return;
        setState(() => _busy = false);
        widget.onSaved?.call();
      case ConnectionFailed(:final message):
        setState(() {
          _busy = false;
          _error = message;
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    final keepsSecret = _current?.hasToken ?? false;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: AutofillGroup(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: _url,
                    decoration: const InputDecoration(
                      labelText: 'Server URL',
                      hintText: 'https://tsuzuku.example.com',
                    ),
                    keyboardType: TextInputType.url,
                    autocorrect: false,
                    enabled: !_busy,
                  ),
                  const SizedBox(height: 24),
                  Text(
                    'Cloudflare Access service token',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Zero Trust → Access controls → Service credentials → Service Tokens. '
                    'Leave both empty for a server without Access, such as the local demo.',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  TextField(
                    controller: _id,
                    decoration: const InputDecoration(
                      labelText: 'Client ID (CF-Access-Client-Id)',
                    ),
                    autocorrect: false,
                    enabled: !_busy,
                  ),
                  TextField(
                    controller: _secret,
                    decoration: InputDecoration(
                      labelText: 'Client secret (CF-Access-Client-Secret)',
                      helperText: keepsSecret
                          ? 'Leave empty to keep the stored secret.'
                          : null,
                    ),
                    obscureText: true,
                    autocorrect: false,
                    enableSuggestions: false,
                    enabled: !_busy,
                  ),
                  const SizedBox(height: 24),
                  if (_error != null) ...[
                    Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                    const SizedBox(height: 16),
                  ],
                  FilledButton(
                    onPressed: _busy ? null : _testAndSave,
                    child: _busy
                        ? const SizedBox.square(
                            dimension: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Test and save'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

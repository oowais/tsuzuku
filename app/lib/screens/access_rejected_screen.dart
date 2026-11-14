import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../app_controller.dart';
import 'server_form.dart';

final _cloudflare = Uri.parse('https://one.dash.cloudflare.com/');

/// Cloudflare Access answered 403 or redirected to its login page instead of the server's JSON.
class AccessRejectedScreen extends StatefulWidget {
  const AccessRejectedScreen({super.key, required this.controller});

  final AppController controller;

  @override
  State<AccessRejectedScreen> createState() => _AccessRejectedScreenState();
}

class _AccessRejectedScreenState extends State<AccessRejectedScreen> {
  bool _retrying = false;

  Future<void> _retry() async {
    setState(() => _retrying = true);
    await widget.controller.retry();
    if (mounted) setState(() => _retrying = false);
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final web = widget.controller.web;
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.all(24),
            children: [
              Icon(
                Icons.lock_outline,
                size: 48,
                color: Theme.of(context).colorScheme.error,
              ),
              const SizedBox(height: 16),
              if (web) ...[
                Text(
                  'Cloudflare Access sign-in has run out',
                  style: text.headlineSmall,
                ),
                const SizedBox(height: 12),
                const Text('Reload the page to sign in again.'),
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: () =>
                      launchUrl(Uri.base, webOnlyWindowName: '_self'),
                  child: const Text('Reload'),
                ),
              ] else ...[
                Text(
                  'Cloudflare Access refused the service token',
                  style: text.headlineSmall,
                ),
                const SizedBox(height: 12),
                const Text(
                  'The token may have expired, been rotated or been deleted. In Cloudflare: '
                  'Zero Trust → Access controls → Service credentials → Service Tokens.',
                ),
                const SizedBox(height: 8),
                const Text(
                  'Refresh keeps the same client ID and secret: refresh, then Retry. '
                  'Rotate gives a new secret: put it in Settings → Server.',
                ),
                const SizedBox(height: 24),
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: [
                    FilledButton.icon(
                      onPressed: () => launchUrl(
                        _cloudflare,
                        mode: LaunchMode.externalApplication,
                      ),
                      icon: const Icon(Icons.open_in_new),
                      label: const Text('Open Cloudflare'),
                    ),
                    OutlinedButton(
                      onPressed: _retrying ? null : _retry,
                      child: Text(_retrying ? 'Retrying…' : 'Retry'),
                    ),
                    OutlinedButton(
                      onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => ServerSettingsScreen(
                            controller: widget.controller,
                          ),
                        ),
                      ),
                      child: const Text('Update in Settings'),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

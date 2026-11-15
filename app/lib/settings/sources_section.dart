import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/tsuzuku_api.dart';
import '../server/server_config.dart';
import '../up_next/format.dart' show countdown;
import '../up_next/source_ui.dart';
import '../writes/write_flows.dart' show writeErrorText;

// Sources in Settings (#108, step 3.6; legacy `SettingsPanel.vue`, `SourceStatusChip.vue`). Connect / Reconnect opens
// the system browser at `<server>/api/auth/<source>/start`: the server signs in with the source and keeps the token,
// encrypted; it never reaches the app. Coming back to the app reads the status again.

const oauthSources = {'trakt', 'simkl', 'mal'};

const _labels = {
  'trakt': 'Trakt',
  'simkl': 'Simkl',
  'mal': 'MyAnimeList',
  'tmdb': 'TMDB',
  'anilist': 'AniList',
};

/// The sign-in page on the server: absolute on native, the page's own origin on web.
Uri authStartUrl(ServerConfig config, String source) {
  final path = '/api/auth/$source/start';
  return config.baseUrl.isEmpty
      ? Uri.base.resolve(path)
      : Uri.parse('${config.baseUrl}$path');
}

enum ChipTone { ok, warning, error, neutral }

/// A source's status chip (legacy `SourceStatusChip`).
({String label, ChipTone tone, IconData icon}) statusChip(
  SourceStatusInfo s,
  DateTime now,
) {
  switch (s.status?.toJson()) {
    case 'ok':
      return (label: 'OK', tone: ChipTone.ok, icon: Icons.check_circle_outline);
    case 'rate_limited':
      final left = s.blockedUntil?.difference(now);
      return (
        label:
            'Rate limited${left != null && !left.isNegative ? ' · ${countdown(left)}' : ''}',
        tone: ChipTone.warning,
        icon: Icons.timer_outlined,
      );
    case 'auth_expired':
      return (
        label: 'Auth expired',
        tone: ChipTone.error,
        icon: Icons.key_off_outlined,
      );
    case 'error':
      return (label: 'Error', tone: ChipTone.error, icon: Icons.error_outline);
    default:
      return oauthSources.contains(s.source.toJson()) && !s.connected
          ? (
              label: 'Not connected',
              tone: ChipTone.neutral,
              icon: Icons.power_off_outlined,
            )
          : (
              label: 'Not checked yet',
              tone: ChipTone.neutral,
              icon: Icons.radio_button_unchecked,
            );
  }
}

class SourcesSection extends StatefulWidget {
  const SourcesSection({
    super.key,
    required this.api,
    required this.config,
    this.open,
    this.clock = DateTime.now,
  });

  final TsuzukuApi api;
  final ServerConfig config;

  /// Opens a URL in the system browser; replaceable in tests.
  final Future<bool> Function(Uri url)? open;
  final DateTime Function() clock;

  @override
  State<SourcesSection> createState() => SourcesSectionState();
}

class SourcesSectionState extends State<SourcesSection>
    with WidgetsBindingObserver {
  List<SourceStatusInfo>? _sources;
  Object? _error;
  bool _loading = false;
  Timer? _tick;
  late DateTime _now = widget.clock();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      final now = widget.clock();
      final counting = (_sources ?? const []).any(
        (s) => s.blockedUntil?.isAfter(now) ?? false,
      );
      if (counting) setState(() => _now = now);
    });
    reload();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _tick?.cancel();
    super.dispose();
  }

  /// Back from the browser's sign-in: read the status again.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) reload();
  }

  Future<void> reload() async {
    if (_loading) return;
    setState(() => _loading = true);
    try {
      final s = await widget.api.sources.getSourcesStatus();
      if (mounted) {
        setState(() {
          _sources = s;
          _error = null;
          _now = widget.clock();
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _connect(String source) async {
    final url = authStartUrl(widget.config, source);
    final opened =
        await (widget.open ??
            (u) => launchUrl(
              u,
              mode: LaunchMode.externalApplication,
              webOnlyWindowName: '_self',
            ))(url);
    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Could not open the browser for ${sourceLabel(source)}',
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final sources = _sources;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                'Connect your sources. Connect opens your browser at the server\'s sign-in; '
                'tokens are stored encrypted on the server.',
                style: muted,
              ),
            ),
            IconButton(
              key: const ValueKey('sources-refresh'),
              onPressed: _loading ? null : reload,
              icon: const Icon(Icons.refresh),
              tooltip: 'Refresh',
            ),
          ],
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              'Could not read the sources: ${writeErrorText(_error!)}',
              style: TextStyle(color: theme.colorScheme.error),
            ),
          ),
        if (sources == null && _error == null)
          const Padding(
            padding: EdgeInsets.all(16),
            child: Center(child: CircularProgressIndicator()),
          ),
        if (sources != null)
          LayoutBuilder(
            builder: (context, box) {
              final across = box.maxWidth >= 1000
                  ? 3
                  : box.maxWidth >= 640
                  ? 2
                  : 1;
              final w = (box.maxWidth - 8 * (across - 1)) / across;
              return Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final s in sources)
                    SizedBox(width: w, child: _tile(context, s)),
                ],
              );
            },
          ),
      ],
    );
  }

  Widget _tile(BuildContext context, SourceStatusInfo s) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final source = s.source.toJson();
    final chip = statusChip(s, _now);
    final dark = theme.brightness == Brightness.dark;
    final chipColor = switch (chip.tone) {
      ChipTone.ok => dark ? Colors.green.shade300 : Colors.green.shade800,
      ChipTone.warning => dark ? Colors.amber.shade300 : Colors.amber.shade900,
      ChipTone.error => scheme.error,
      ChipTone.neutral => scheme.onSurfaceVariant,
    };
    final expired = s.status?.toJson() == 'auth_expired';
    final tooltip = [
      if (s.lastFetchAt != null) 'Last fetch ${s.lastFetchAt!.toLocal()}',
      ?s.lastError,
    ].join(' · ');
    return Container(
      key: ValueKey('source:$source'),
      padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
      decoration: BoxDecoration(
        border: Border.all(color: scheme.outlineVariant),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          Expanded(
            child: Wrap(
              spacing: 10,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    SourceIcon(source),
                    const SizedBox(width: 4),
                    Flexible(
                      child: Text(
                        _labels[source] ?? source,
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                    ),
                  ],
                ),
                Tooltip(
                  message: tooltip.isEmpty ? 'No calls yet' : tooltip,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 7,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: chipColor.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(chip.icon, size: 13, color: chipColor),
                        const SizedBox(width: 4),
                        Flexible(
                          child: Text(
                            chip.label,
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: chipColor,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          if (oauthSources.contains(source))
            expired || !s.connected
                ? FilledButton(
                    key: ValueKey('connect:$source'),
                    style: expired
                        ? FilledButton.styleFrom(
                            backgroundColor: scheme.error,
                            foregroundColor: scheme.onError,
                          )
                        : null,
                    onPressed: () => _connect(source),
                    child: Text(s.connected ? 'Reconnect' : 'Connect'),
                  )
                : OutlinedButton(
                    key: ValueKey('connect:$source'),
                    onPressed: () => _connect(source),
                    child: const Text('Reconnect'),
                  )
          else
            Text(
              'No sign-in needed',
              style: theme.textTheme.bodySmall?.copyWith(
                color: scheme.onSurfaceVariant,
              ),
            ),
        ],
      ),
    );
  }
}

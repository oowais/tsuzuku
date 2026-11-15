import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../api/tsuzuku_api.dart';
import '../up_next/format.dart' show relativeTo;
import '../writes/write_flows.dart' show writeErrorText;
import '../theme/solid_glass.dart';

// Backups in Settings (#108, step 3.6; legacy `SettingsPanel.vue`): a copy of the database made nightly or on "Back up
// now", kept next to it on the server. Download fetches the file through the API (with the Access headers on native,
// the browser's cookie on web) and hands it to the platform's save dialog, or the browser's download on web.

String backupSize(num bytes) => bytes >= 1024 * 1024
    ? '${(bytes / 1024 / 1024).toStringAsFixed(1)} MB'
    : '${(bytes / 1024).round().clamp(1, 1023)} KB';

const _months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/// "15 Nov 2026, 03:00", local time.
String backupTime(DateTime at) {
  final t = at.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${t.day} ${_months[t.month - 1]} ${t.year}, ${two(t.hour)}:${two(t.minute)}';
}

/// Saves bytes under a name; returns false when the dialog was cancelled.
typedef SaveFile = Future<bool> Function(String name, Uint8List bytes);

Future<bool> saveWithPicker(String name, Uint8List bytes) async {
  final uri = await FilePicker.saveFile(
    fileName: name,
    bytes: bytes,
    mimeType: 'application/vnd.sqlite3',
    dialogTitle: 'Save backup',
  );
  return uri != null;
}

class BackupsSection extends StatefulWidget {
  const BackupsSection({
    super.key,
    required this.api,
    this.save = saveWithPicker,
    this.clock = DateTime.now,
  });

  final TsuzukuApi api;
  final SaveFile save;
  final DateTime Function() clock;

  @override
  State<BackupsSection> createState() => _BackupsSectionState();
}

class _BackupsSectionState extends State<BackupsSection> {
  List<BackupFile>? _backups;
  Object? _error;
  bool _backingUp = false;
  String? _downloading;
  bool _showOlder = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final b = await widget.api.backups.getBackups();
      if (mounted) {
        setState(() {
          _backups = b;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  void _say(String text) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  Future<void> _backUp() async {
    setState(() => _backingUp = true);
    try {
      final b = await widget.api.backups.postBackups();
      _say('Backup made: ${b.name}');
      await _load();
    } catch (e) {
      _say('Backup failed: ${writeErrorText(e)}');
    } finally {
      if (mounted) setState(() => _backingUp = false);
    }
  }

  Future<void> _download(BackupFile b) async {
    setState(() => _downloading = b.name);
    try {
      final bytes = await widget.api.backups.getBackupsName(name: b.name);
      final saved = await widget.save(b.name, Uint8List.fromList(bytes));
      if (saved) _say('Saved ${b.name}');
    } catch (e) {
      _say('Download failed: ${writeErrorText(e)}');
    } finally {
      if (mounted) setState(() => _downloading = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final backups = _backups;
    final now = widget.clock();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: Text(
                'A copy of the database: your links, offsets, accepted differences and write log. Source '
                'tokens are in it encrypted; the key is not. One is made every night at 03:00; the newest '
                '14 are kept.',
                style: muted,
              ),
            ),
            const SizedBox(width: 12),
            FilledButton.icon(
              key: const ValueKey('back-up-now'),
              onPressed: _backingUp ? null : _backUp,
              icon: _backingUp
                  ? const SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.backup_outlined),
              label: const Text('Back up now'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (_error != null)
          Text(
            'Could not list the backups: ${writeErrorText(_error!)}',
            style: TextStyle(color: theme.colorScheme.error),
          ),
        if (backups != null)
          PaneCard(
            radius: Glass.controlRadius,
            child: Column(
              children: [
                if (backups.isEmpty)
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: Text(
                      'No backups yet.',
                      style: theme.textTheme.bodyMedium,
                    ),
                  ),
                // The newest only; the older ones behind a toggle.
                for (final (i, b)
                    in backups
                        .take(_showOlder ? backups.length : 1)
                        .indexed) ...[
                  if (i > 0) const Divider(height: 1),
                  ListTile(
                    key: ValueKey('backup:${b.name}'),
                    dense: true,
                    title: Tooltip(
                      message: b.name,
                      child: Text(backupTime(b.createdAt)),
                    ),
                    subtitle: Text(
                      '${relativeTo(b.createdAt, now)} · ${backupSize(b.size)}',
                    ),
                    trailing: _downloading == b.name
                        ? const SizedBox.square(
                            dimension: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : IconButton(
                            key: ValueKey('download:${b.name}'),
                            onPressed: _downloading != null
                                ? null
                                : () => _download(b),
                            icon: const Icon(Icons.download_outlined),
                            tooltip: 'Download',
                          ),
                  ),
                ],
                if (backups.length > 1) ...[
                  const Divider(height: 1),
                  TextButton.icon(
                    key: const ValueKey('backups-older-toggle'),
                    onPressed: () => setState(() => _showOlder = !_showOlder),
                    icon: Icon(
                      _showOlder ? Icons.expand_less : Icons.expand_more,
                    ),
                    label: Text(
                      _showOlder
                          ? 'Hide older backups'
                          : 'Show ${backups.length - 1} older '
                                '${backups.length == 2 ? 'backup' : 'backups'}',
                    ),
                  ),
                ],
              ],
            ),
          ),
      ],
    );
  }
}

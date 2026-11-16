import 'package:flutter/material.dart';

import '../server/connection.dart';
import '../up_next/format.dart';
import '../up_next/up_next_screen.dart' show Notice;

/// The note over a screen that is offline, or whose live read failed while it shows a saved answer
/// (#108, 3.7). While the live read runs, the loading bar is enough; once it fails, the saved answer's
/// fetch time is here, so it is never taken for live. Offline, writes are off and nothing is queued.
class SnapshotNotice extends StatelessWidget {
  const SnapshotNotice({
    super.key,
    required this.savedAt,
    required this.offline,
    required this.now,
    this.error,
  });

  /// When the shown answer was fetched, while it is the saved one; null once the live answer is in.
  final DateTime? savedAt;
  final bool offline;
  final DateTime now;

  /// The live read that failed, if it did.
  final Object? error;

  /// Whether there is anything to say.
  static bool shows({
    required DateTime? savedAt,
    required bool offline,
    required bool loading,
  }) => (savedAt != null && !loading) || offline;

  @override
  Widget build(BuildContext context) {
    final saved = savedAt;
    final local = saved?.toLocal();
    final title = saved == null
        ? 'Offline.'
        : 'Saved copy from ${relativeTo(saved, now)} '
              '(${MaterialLocalizations.of(context).formatShortDate(local!)} '
              '${TimeOfDay.fromDateTime(local).format(context)}), not live.';
    final String? text;
    if (offline) {
      text =
          'The server cannot be reached: read-only, writes are off and nothing is queued. '
          'Pull to refresh when you are back online.';
    } else if (error != null) {
      text = 'Could not refresh: ${describeError(error!)}.';
    } else {
      text = null;
    }
    return Notice(
      key: const ValueKey('snapshot-notice'),
      icon: offline ? Icons.cloud_off : Icons.history,
      warning: offline || error != null,
      title: title,
      text: text,
    );
  }
}

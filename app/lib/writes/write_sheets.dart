import 'package:flutter/material.dart';

import '../api/tsuzuku_api.dart';
import '../up_next/format.dart';
import '../up_next/source_ui.dart';
import '../up_next/up_next_card.dart' show openUrl;
import 'write_flows.dart';
import '../theme/solid_glass.dart';

// The preview-and-confirm sheets (#108, step 3.5): a bottom sheet on phones, a dialog on wide screens.
// Nothing is written until the confirm button; each source's step can be unticked first.

/// List statuses as Simkl and MAL name them, for display (legacy `LIST_STATUS_LABELS`).
const listStatusLabels = {
  'completed': 'Completed',
  'hold': 'On hold',
  'on_hold': 'On hold',
  'dropped': 'Dropped',
  'watching': 'Watching',
  'plantowatch': 'Plan to watch',
  'plan_to_watch': 'Plan to watch',
};

String listStatusLabel(String s) => listStatusLabels[s] ?? s;

/// Opens [child] as a bottom sheet (narrow) or a dialog (wide).
Future<void> showWriteSheet(BuildContext context, Widget child) {
  // Both are a pane of the floating layer (Solid Glass): the thickest glass, lit along the top.
  if (MediaQuery.sizeOf(context).width < 640) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      // The pane draws its own edges; the theme's would draw them twice.
      shape: const RoundedRectangleBorder(),
      builder: (_) => FloatPane(
        borderRadius: const BorderRadius.vertical(
          top: Radius.circular(Glass.paneRadius + 6),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const _DragHandle(),
            Flexible(child: child),
          ],
        ),
      ),
    );
  }
  return showDialog<void>(
    context: context,
    builder: (_) => Dialog(
      backgroundColor: Colors.transparent,
      elevation: 0,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560, maxHeight: 720),
        child: FloatPane(child: child),
      ),
    ),
  );
}

class _DragHandle extends StatelessWidget {
  const _DragHandle();

  @override
  Widget build(BuildContext context) => Center(
    child: Container(
      margin: const EdgeInsets.only(top: 10),
      width: 36,
      height: 4,
      decoration: BoxDecoration(
        color: Glass.of(context).borderAccented,
        borderRadius: BorderRadius.circular(2),
      ),
    ),
  );
}

/// Title, scrolling body and the button row of a sheet.
class SheetFrame extends StatelessWidget {
  const SheetFrame({
    super.key,
    required this.title,
    this.subtitle,
    required this.body,
    required this.actions,
  });

  final String title;
  final String? subtitle;
  final Widget body;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    // Above the keyboard, else above the system's gesture bar or nav buttons.
    final keyboard = MediaQuery.viewInsetsOf(context).bottom;
    final system = MediaQuery.viewPaddingOf(context).bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: keyboard > system ? keyboard : system),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: theme.textTheme.titleLarge),
                if (subtitle != null)
                  Text(
                    subtitle!,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
              ],
            ),
          ),
          Flexible(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 8),
              child: body,
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
            child: Wrap(
              alignment: WrapAlignment.end,
              spacing: 8,
              runSpacing: 8,
              children: actions,
            ),
          ),
        ],
      ),
    );
  }
}

class SheetAlert extends StatelessWidget {
  const SheetAlert({
    super.key,
    required this.text,
    this.description,
    this.error = false,
    this.icon,
  });

  final String text;
  final String? description;
  final bool error;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tint = error ? theme.colorScheme.error : Glass.of(context).warning;
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: tint.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: tint.withValues(alpha: 0.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            icon ?? (error ? Icons.error_outline : Icons.warning_amber),
            size: 18,
            color: tint,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(text, style: const TextStyle(fontWeight: FontWeight.w600)),
                if (description != null)
                  Text(description!, style: theme.textTheme.bodySmall),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// "done" with the list status the source reports, or the source's error.
class OutcomeMark extends StatelessWidget {
  const OutcomeMark(this.outcome, {super.key});

  final WriteOutcome outcome;

  @override
  Widget build(BuildContext context) {
    final status = outcome.listStatus;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.check, size: 16, color: Glass.of(context).success),
        const SizedBox(width: 4),
        Text(
          'done${status != null && status != 'watching' ? ' · ${listStatusLabel(status)}' : ''}',
          style: TextStyle(color: Glass.of(context).success),
        ),
      ],
    );
  }
}

Widget errorLine(BuildContext context, String text) => Padding(
  padding: const EdgeInsets.only(top: 2),
  child: Text(
    text,
    style: TextStyle(color: Theme.of(context).colorScheme.error),
  ),
);

const _scopeLabels = {'show': 'whole show', 'season': 'this season only'};

/// "Mark watched" (legacy `MarkWatchedModal.vue`).
class MarkSheet extends StatefulWidget {
  const MarkSheet({
    super.key,
    required this.flow,
    required this.title,
    DateTime Function()? clock,
  }) : clock = clock ?? DateTime.now;

  final MarkFlow flow;

  /// The row's title.
  final String title;
  final DateTime Function() clock;

  @override
  State<MarkSheet> createState() => _MarkSheetState();
}

class _MarkSheetState extends State<MarkSheet> {
  MarkFlow get flow => widget.flow;

  @override
  void initState() {
    super.initState();
    if (flow.plan == null && !flow.loading) flow.preview();
  }

  Future<void> _confirm() async {
    final close = await flow.confirm();
    if (close && mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: flow,
    builder: (context, _) {
      final plan = flow.plan;
      final pending = flow.pending;
      final String confirmLabel;
      if (flow.anyFailed) {
        confirmLabel = 'Retry';
      } else if (flow.oneSource && plan!.steps.isNotEmpty) {
        confirmLabel =
            'Mark watched on ${sourceLabel(plan.steps.first.source.toJson())}';
      } else {
        confirmLabel =
            'Mark watched on ${pending.length} ${pending.length == 1 ? 'source' : 'sources'}';
      }
      return SheetFrame(
        title: 'Mark watched',
        body: _body(context),
        actions: [
          TextButton(
            key: const ValueKey('write-cancel'),
            onPressed: () => Navigator.of(context).pop(),
            child: Text(flow.allDone ? 'Close' : 'Cancel'),
          ),
          if (plan != null && !flow.allDone)
            FilledButton.icon(
              key: const ValueKey('write-confirm'),
              onPressed: flow.loading || flow.saving || pending.isEmpty
                  ? null
                  : _confirm,
              icon: flow.saving
                  ? const SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Icon(flow.anyFailed ? Icons.refresh : Icons.check),
              label: Text(confirmLabel),
            ),
        ],
      );
    },
  );

  Widget _body(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    if (flow.loading) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 24),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    if (flow.loadError != null) {
      return SheetAlert(text: flow.loadError!, error: true);
    }
    final plan = flow.plan;
    if (plan == null) return const SizedBox.shrink();
    final now = widget.clock();
    final aired = plan.episode?.airedAt;
    final airedLabel = aired != null && !isFuture(aired, now)
        ? shortDate(aired, now)
        : null;
    final future = flow.future;
    final ratable = flow.ratable;
    final lastMark = plan.changed?.lastMark;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '${plan.episode?.label ?? 'Next episode'}'
          '${plan.episode?.name != null ? ' · “${plan.episode!.name}”' : ''}',
          style: theme.textTheme.titleLarge?.copyWith(
            fontWeight: FontWeight.w700,
          ),
        ),
        Text(
          '${widget.title}${airedLabel != null ? ' · aired $airedLabel' : ''}',
          style: muted,
        ),
        if (plan.changed != null)
          SheetAlert(
            icon: Icons.sync_problem,
            text: 'Changed since this page loaded',
            description: lastMark != null
                ? '${lastMark.episode} was marked at ${_clock(lastMark.at)}, so the next episode is now '
                      'the one above. The list behind is reloaded.'
                : "This show moved on, maybe on the source's own site or app, so the next episode is "
                      'now the one above. The list behind is reloaded.',
          ),
        if (future != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text.rich(
              key: const ValueKey('future-warning'),
              TextSpan(
                style: TextStyle(color: Glass.of(context).warning),
                children: [
                  const WidgetSpan(
                    alignment: PlaceholderAlignment.middle,
                    child: Icon(Icons.warning_amber, size: 16),
                  ),
                  TextSpan(
                    text:
                        ' Airs ${shortDate(future.date, now) ?? future.date} '
                        '(${relativeTime(future.date, now) ?? ''}) on ',
                  ),
                  sourceSpan(future.by.toJson()),
                  const TextSpan(
                    text: ". Mark it only if you've already watched it.",
                  ),
                ],
              ),
            ),
          ),
        if (ratable.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Wrap(
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 12,
              runSpacing: 4,
              children: [
                Text('Your rating', style: muted),
                ScoreMenu(
                  key: const ValueKey('rating-shared'),
                  value: flow.sharedScore,
                  enabled: !flow.saving,
                  onChanged: flow.setShared,
                ),
                if (ratable.length > 1)
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Checkbox(
                        value: flow.splitRating,
                        onChanged: flow.saving
                            ? null
                            : (v) => flow.setSplit(v ?? false),
                      ),
                      const Text('Different per source'),
                    ],
                  ),
              ],
            ),
          ),
        const SizedBox(height: 12),
        DecoratedBox(
          decoration: BoxDecoration(
            border: Border.all(color: theme.colorScheme.outlineVariant),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Column(
            children: [
              for (final (i, s) in plan.steps.indexed) ...[
                if (i > 0) const Divider(height: 1),
                _stepRow(context, s),
              ],
              for (final s in plan.skipped) ...[
                const Divider(height: 1),
                Padding(
                  key: ValueKey('skipped:${s.source.toJson()}'),
                  padding: const EdgeInsets.all(12),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text.rich(
                      TextSpan(
                        style: muted,
                        children: [
                          sourceSpan(s.source.toJson()),
                          TextSpan(text: ': ${s.reason}'),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
              if (plan.steps.isEmpty)
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: Text('Nothing can be marked right now.', style: muted),
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _stepRow(BuildContext context, MarkStep s) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final source = s.source.toJson();
    final outcome = flow.outcomes[source];
    final done = outcome?.ok ?? false;
    final all = !flow.oneSource;
    final canToggle = all && !flow.saving && !done;
    // The note without the status the preview suggested; the picker shows the status.
    final note = s.after != null
        ? s.note.replaceFirst(RegExp(r', [a-z ]+$'), '')
        : s.note;
    final rating = s.rating;
    return InkWell(
      key: ValueKey('step:$source'),
      onTap: canToggle
          ? () => flow.toggle(source, !flow.picked.contains(source))
          : null,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (all)
              Checkbox(
                key: ValueKey('pick:$source'),
                value: flow.picked.contains(source),
                onChanged: canToggle
                    ? (v) => flow.toggle(source, v ?? false)
                    : null,
              )
            else
              const SizedBox(width: 12),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(top: 10, right: 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(
                      spacing: 8,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        SourceName(source, style: muted),
                        Text(
                          s.episode,
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                        if (s.title != widget.title)
                          Text(
                            s.title,
                            style: muted,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                      ],
                    ),
                    if (s.after != null && !done)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Wrap(
                          spacing: 8,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            Text('After this', style: muted),
                            DropdownButton<String>(
                              key: ValueKey('after:$source'),
                              value: flow.after[source],
                              isDense: true,
                              onChanged: flow.saving
                                  ? null
                                  : (v) => flow.setAfter(source, v ?? leave),
                              items: [
                                DropdownMenuItem(
                                  value: leave,
                                  // Simkl files a finished item itself (Completed); MAL stays on Watching.
                                  child: Text(
                                    source == 'simkl'
                                        ? 'Leave to Simkl'
                                        : 'Keep watching',
                                  ),
                                ),
                                for (final o in s.after!.options)
                                  DropdownMenuItem(
                                    value: o.toJson(),
                                    child: Text(listStatusLabel(o.toJson())),
                                  ),
                              ],
                            ),
                            if (source == 'mal' &&
                                flow.after[source] == 'completed')
                              Text(
                                'finish date today, unless MAL has one',
                                style: muted,
                              ),
                          ],
                        ),
                      ),
                    if (source == 'mal' && s.expected.startsWith('0|') && !done)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(
                          'Start date today, unless MAL has one',
                          style: muted,
                        ),
                      ),
                    if (rating != null && !done)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Wrap(
                          spacing: 8,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            if (flow.splitRating) ...[
                              Text('Rate', style: muted),
                              ScoreMenu(
                                key: ValueKey('rating:$source'),
                                value: flow.rateValue[source] ?? 0,
                                enabled: !flow.saving,
                                onChanged: (v) => flow.setRate(source, v),
                              ),
                            ],
                            Text(
                              '${_scopeLabels[rating.scope.toJson()] ?? rating.scope.toJson()}'
                              '${rating.unknown
                                  ? ' · current rating unknown'
                                  : rating.current != null && rating.current != 0
                                  ? ' · now ${rating.current!.toInt()}'
                                  : ' · not rated'}',
                              style: muted,
                            ),
                          ],
                        ),
                      ),
                    if (outcome?.ratingError != null)
                      errorLine(
                        context,
                        'Marked, but the rating failed: ${outcome!.ratingError}',
                      ),
                    if (outcome != null && !outcome.ok)
                      KeyedSubtree(
                        key: ValueKey('error:$source'),
                        child: errorLine(context, outcome.error ?? 'failed'),
                      ),
                    const SizedBox(height: 6),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.only(top: 10, right: 8),
              child: done
                  ? OutcomeMark(outcome!)
                  : Text(note, style: theme.textTheme.bodySmall),
            ),
          ],
        ),
      ),
    );
  }

  String _clock(DateTime at) {
    final l = at.toLocal();
    return '${l.hour.toString().padLeft(2, '0')}:${l.minute.toString().padLeft(2, '0')}';
  }
}

class ScoreMenu extends StatelessWidget {
  const ScoreMenu({
    super.key,
    required this.value,
    required this.enabled,
    required this.onChanged,
  });

  final int value;
  final bool enabled;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) => DropdownButton<int>(
    value: value,
    isDense: true,
    onChanged: enabled ? (v) => onChanged(v ?? 0) : null,
    items: [
      const DropdownMenuItem(value: 0, child: Text("Don't rate")),
      for (var i = 1; i <= 10; i++)
        DropdownMenuItem(value: i, child: Text('$i')),
    ],
  );
}

/// "Start next season" (legacy `StartSeasonModal.vue`).
class StartSeasonSheet extends StatefulWidget {
  const StartSeasonSheet({super.key, required this.flow});

  final StartFlow flow;

  @override
  State<StartSeasonSheet> createState() => _StartSeasonSheetState();
}

class _StartSeasonSheetState extends State<StartSeasonSheet> {
  StartFlow get flow => widget.flow;
  late final _query = TextEditingController(text: flow.query);

  @override
  void initState() {
    super.initState();
    if (flow.plan == null && !flow.loading) flow.preview();
  }

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  Future<void> _confirm() async {
    final close = await flow.confirm();
    if (close && mounted) Navigator.of(context).pop();
  }

  void _search() {
    flow.query = _query.text;
    flow.runSearch();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: flow,
    builder: (context, _) {
      final pending = flow.pending;
      final canConfirm =
          flow.target != null && !flow.searching && !flow.allDone;
      return SheetFrame(
        title: 'Start next season',
        subtitle: flow.title,
        body: _body(context),
        actions: [
          TextButton(
            key: const ValueKey('write-cancel'),
            onPressed: () => Navigator.of(context).pop(),
            child: Text(flow.allDone ? 'Close' : 'Cancel'),
          ),
          if (canConfirm)
            FilledButton.icon(
              key: const ValueKey('write-confirm'),
              onPressed: flow.loading || flow.saving || pending.isEmpty
                  ? null
                  : _confirm,
              icon: flow.saving
                  ? const SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Icon(flow.anyFailed ? Icons.refresh : Icons.play_arrow),
              label: Text(
                flow.anyFailed
                    ? 'Retry'
                    : 'Start on ${pending.length} ${pending.length == 1 ? 'source' : 'sources'}',
              ),
            ),
        ],
      );
    },
  );

  Widget _candidateList(List<StartCandidate> list, {String? empty}) {
    final theme = Theme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(color: theme.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        children: [
          for (final (i, c) in list.indexed) ...[
            if (i > 0) const Divider(height: 1),
            ListTile(
              key: ValueKey('candidate:${c.malId}'),
              dense: true,
              title: InkWell(
                onTap: () => openUrl(c.malUrl),
                child: Text(
                  c.title,
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    decoration: TextDecoration.underline,
                    decorationStyle: TextDecorationStyle.dotted,
                  ),
                ),
              ),
              subtitle: Text(c.describe),
              trailing: FilledButton.tonal(
                onPressed: () => flow.pick(c),
                child: const Text('Pick'),
              ),
            ),
          ],
          if (list.isEmpty && empty != null)
            Padding(padding: const EdgeInsets.all(12), child: Text(empty)),
        ],
      ),
    );
  }

  Widget _body(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final plan = flow.plan;
    final target = flow.target;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (flow.loadError != null)
          SheetAlert(text: flow.loadError!, error: true),
        if (flow.searching) ...[
          const SizedBox(height: 8),
          if (!flow.search)
            Text(
              'AniList names no next season for the linked entry. Search for it:',
              style: muted,
            )
          else
            Text.rich(
              TextSpan(
                style: muted,
                children: [
                  const TextSpan(
                    text: 'Nothing links this show to an anime yet. Pick the entry that matches ',
                  ),
                  sourceSpan('trakt'),
                  TextSpan(text: ' ${plan?.traktNext ?? 'next episode'}:'),
                ],
              ),
            ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: TextField(
                  key: const ValueKey('start-search'),
                  controller: _query,
                  decoration: const InputDecoration(
                    isDense: true,
                    prefixIcon: Icon(Icons.search),
                    border: OutlineInputBorder(),
                    labelText: 'Search AniList',
                  ),
                  onSubmitted: (_) => _search(),
                ),
              ),
              const SizedBox(width: 8),
              OutlinedButton(
                onPressed: flow.searchLoading ? null : _search,
                child: const Text('Search'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (flow.searchLoading) const LinearProgressIndicator(),
          if (flow.results != null)
            _candidateList(flow.results!, empty: 'No anime found.'),
        ] else if (flow.loading)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Center(child: CircularProgressIndicator()),
          )
        else if (plan != null && target == null && plan.choices.isNotEmpty) ...[
          Text(
            'AniList names more than one next entry. Which one?',
            style: muted,
          ),
          const SizedBox(height: 8),
          _candidateList([for (final c in plan.choices) StartCandidate.of(c)]),
        ] else if (plan != null && target != null) ...[
          InkWell(
            onTap: () => openUrl(target.malUrl),
            child: Text(
              target.title,
              key: const ValueKey('start-target'),
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w700,
                decoration: TextDecoration.underline,
                decorationStyle: TextDecorationStyle.dotted,
              ),
            ),
          ),
          Text(target.describe, style: muted),
          if (plan.placement != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text.rich(
                TextSpan(
                  style: muted,
                  children: plan.placement!.linked
                      ? [
                          const TextSpan(text: 'Already linked to '),
                          sourceSpan('trakt'),
                          TextSpan(
                            text: ' S${plan.placement!.traktSeason.toInt()}.',
                          ),
                        ]
                      : [
                          const TextSpan(text: 'Will be linked to '),
                          sourceSpan('trakt'),
                          TextSpan(
                            text:
                                ' S${plan.placement!.traktSeason.toInt()}'
                                '${plan.placement!.episodeOffset != 0 ? ' (offset ${plan.placement!.episodeOffset.toInt()})' : ''}'
                                '; ',
                          ),
                          sourceSpan('trakt'),
                          TextSpan(text: "'s next is ${plan.traktNext}."),
                        ],
                ),
              ),
            ),
          if (!flow.rowKey.startsWith('coming:'))
            TextButton(
              style: TextButton.styleFrom(padding: EdgeInsets.zero),
              onPressed: flow.openSearch,
              child: const Text('Not this one? Search'),
            ),
          const SizedBox(height: 8),
          DecoratedBox(
            decoration: BoxDecoration(
              border: Border.all(color: theme.colorScheme.outlineVariant),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Column(
              children: [
                for (final (i, s) in plan.steps.indexed) ...[
                  if (i > 0) const Divider(height: 1),
                  _stepRow(context, s),
                ],
                for (final s in plan.skipped) ...[
                  const Divider(height: 1),
                  Padding(
                    key: ValueKey('skipped:${s.source.toJson()}'),
                    padding: const EdgeInsets.all(12),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Text.rich(
                        TextSpan(
                          style: muted,
                          children: [
                            sourceSpan(s.source.toJson()),
                            TextSpan(text: ': ${s.reason}'),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
                if (plan.steps.isEmpty)
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: Text('Nothing to start right now.', style: muted),
                  ),
              ],
            ),
          ),
          if (flow.linkError != null)
            SheetAlert(
              text: 'Started, but not linked: ${flow.linkError}',
              description: 'Link it on Mappings once it shows on your list.',
            ),
        ],
      ],
    );
  }

  Widget _stepRow(BuildContext context, StartStep s) {
    final theme = Theme.of(context);
    final source = s.source.toJson();
    final outcome = flow.outcomes[source];
    final done = outcome?.ok ?? false;
    final canToggle = !flow.saving && !done;
    return InkWell(
      key: ValueKey('step:$source'),
      onTap: canToggle
          ? () => flow.toggle(source, !flow.picked.contains(source))
          : null,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Checkbox(
              key: ValueKey('pick:$source'),
              value: flow.picked.contains(source),
              onChanged: canToggle
                  ? (v) => flow.toggle(source, v ?? false)
                  : null,
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(top: 10, right: 8, bottom: 6),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SourceName(
                      source,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    Text(
                      s.summary,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    if (outcome != null && !outcome.ok)
                      KeyedSubtree(
                        key: ValueKey('error:$source'),
                        child: errorLine(context, outcome.error ?? 'failed'),
                      ),
                  ],
                ),
              ),
            ),
            if (done)
              Padding(
                padding: const EdgeInsets.only(top: 10, right: 8),
                child: OutcomeMark(outcome!),
              ),
          ],
        ),
      ),
    );
  }
}

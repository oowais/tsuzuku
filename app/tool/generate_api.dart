// Generates the API client in lib/api/ from the contract, ../api/openapi.yaml (#108).
//
//   dart run tool/generate_api.dart          regenerate lib/api/
//   dart run tool/generate_api.dart --check  fail if lib/api/ is out of date (CI)
//
// The contract stays exactly as the legacy contract check needs it; this tool feeds swagger_parser a
// copy with changes that only matter to the generated Dart:
//
// - `anyOf: [{type: "null"}, X]` (how zod writes a nullable value) becomes X with null allowed, so
//   fields come out as `String?` instead of a wrapper class with `hasNull` / `asString`.
// - `additionalProperties: false` is dropped, so a field the server adds later (an additive change,
//   no `apiVersion` bump) does not break an older app. The contract check still rejects such fields
//   on the server side until the spec lists them.
// - `const` / `enum` without a `type` (zod literals) get the type of their values.
import 'dart:convert';
import 'dart:io';

import 'package:yaml/yaml.dart';

const _source = '../api/openapi.yaml';
const _normalized = '.dart_tool/tsuzuku/openapi.json';

Future<void> main(List<String> args) async {
  final spec = _plain(loadYaml(await File(_source).readAsString()));
  final out = File(_normalized);
  await out.parent.create(recursive: true);
  await out.writeAsString(
    const JsonEncoder.withIndent('  ').convert(_normalize(spec)),
  );

  final result = await Process.start('dart', [
    'run',
    'swagger_parser',
    if (args.contains('--check')) '--check',
  ], mode: ProcessStartMode.inheritStdio);
  exit(await result.exitCode);
}

/// YamlMap / YamlList into plain Dart maps and lists.
Object? _plain(Object? node) => switch (node) {
  YamlMap m => {for (final e in m.entries) e.key.toString(): _plain(e.value)},
  YamlList l => [for (final v in l) _plain(v)],
  _ => node,
};

Object? _normalize(Object? node) {
  if (node is List) return [for (final v in node) _normalize(v)];
  if (node is! Map<String, Object?>) return node;

  final map = <String, Object?>{
    for (final e in node.entries)
      if (!(e.key == 'additionalProperties' && e.value == false))
        e.key: _normalize(e.value),
  };

  // `const: partial_mark` (zod's literal) has no `type`; without one the generated enum takes any JSON
  // scalar and does not compile.
  if (!map.containsKey('type')) {
    final values = map.containsKey('const') ? [map['const']] : map['enum'];
    if (values is List && values.isNotEmpty) {
      final type = _jsonType(values.first);
      if (type != null && values.every((v) => _jsonType(v) == type)) {
        map['type'] = type;
      }
    }
  }

  for (final key in const ['anyOf', 'oneOf']) {
    final branches = map[key];
    if (branches is! List || branches.length != 2) continue;
    final nonNull = branches.where((b) => !_isNull(b)).toList();
    if (nonNull.length != 1) continue;
    final other = nonNull.single as Map<String, Object?>;
    map.remove(key);
    if (other.containsKey(r'$ref')) {
      // A nullable reference: OpenAPI 3.1 has no `nullable`, so wrap the reference in allOf
      // and allow null next to it.
      map['allOf'] = [other];
      map['type'] = ['object', 'null'];
    } else {
      final type = other['type'];
      map.addAll(other);
      map['type'] = [
        ...(type is List ? type : [type]),
        'null',
      ];
      // JSON Schema: an enum that leaves out null still rejects it.
      if (map['enum'] case final List values) map['enum'] = [...values, null];
    }
  }
  return map;
}

String? _jsonType(Object? value) => switch (value) {
  String() => 'string',
  bool() => 'boolean',
  int() => 'integer',
  num() => 'number',
  _ => null,
};

bool _isNull(Object? schema) =>
    schema is Map && schema.length == 1 && schema['type'] == 'null';

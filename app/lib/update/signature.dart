import 'dart:convert';

import 'package:cryptography/cryptography.dart';

/// The raw ed25519 public key the release files are signed for: the last 32 bytes of the DER in
/// `packaging/update-signing-key.pub.pem` (a test checks they match). Never the private key.
const updatePublicKey = '1CCD5UQZ2ztn1OkvZsr/42xdhziKyK04GS7JBBN0Qg0=';

/// Whether [signatureFile] (a `.sig` from the Release: the raw 64-byte ed25519 signature, base64,
/// one line) signs the whole of [data] for [publicKey] (base64, raw 32 bytes). False for anything
/// malformed, never a throw.
Future<bool> verifyUpdateSignature(
  List<int> data,
  String signatureFile, {
  String publicKey = updatePublicKey,
}) async {
  final List<int> signature, key;
  try {
    signature = base64.decode(signatureFile.trim());
    key = base64.decode(publicKey);
  } on FormatException {
    return false;
  }
  if (signature.length != 64 || key.length != 32) return false;
  return Ed25519().verify(
    data,
    signature: Signature(
      signature,
      publicKey: SimplePublicKey(key, type: KeyPairType.ed25519),
    ),
  );
}

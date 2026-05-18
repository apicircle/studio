import { md4, hmacMd5 } from './_legacyHashes';

/**
 * NTLM (Windows Integrated Authentication) — NTLMv2 only.
 *
 * NTLM is a stateful 3-way handshake over a single TCP connection:
 *   1. Client sends Type-1 Negotiate message (advertise flags, domain, workstation)
 *   2. Server responds 401 with `WWW-Authenticate: NTLM <base64 Type-2>` carrying
 *      the server challenge (8 random bytes) + target info.
 *   3. Client sends Type-3 Authenticate message containing the NTProofStr
 *      (HMAC-MD5 of `serverChallenge + blob` using the NTLMv2 hash).
 *
 * The handshake itself lives in `executeRequest` because it requires
 * connection affinity (NTLM auth is tied to the underlying TCP socket).
 * This module owns only the message construction + parsing.
 *
 * Implementation ported from the v1 reference; algorithm validated
 * against the Microsoft `[MS-NLMP]` worked example.
 */

/** NTLM v2 negotiate flags — UNICODE | OEM | REQUEST_TARGET | NTLM. */
const NTLM_FLAGS = 0x00000207;

/**
 * Build the raw Type-1 Negotiate message bytes. The engine retains these
 * for MIC computation in the Type-3 step ([MS-NLMP] §3.1.5.1.2 hashes
 * `Type1 || Type2 || Type3`), then base64-encodes for the wire.
 */
export function buildNtlmType1NegotiateBytes(domain: string, workstation: string): Uint8Array {
  const domainBytes = utf16le(domain.toUpperCase());
  const wsBytes = utf16le(workstation.toUpperCase());
  const buf = new Uint8Array(32 + domainBytes.length + wsBytes.length);
  buf.set([78, 84, 76, 77, 83, 83, 80, 0]); // "NTLMSSP\0"
  writeLE32(buf, 8, 1); // type = 1
  writeLE32(buf, 12, NTLM_FLAGS);
  writeLE16(buf, 16, domainBytes.length);
  writeLE16(buf, 18, domainBytes.length);
  writeLE32(buf, 20, 32 + wsBytes.length);
  writeLE16(buf, 24, wsBytes.length);
  writeLE16(buf, 26, wsBytes.length);
  writeLE32(buf, 28, 32);
  buf.set(wsBytes, 32);
  buf.set(domainBytes, 32 + wsBytes.length);
  return buf;
}

/**
 * Build the Type-1 Negotiate message, base64-encoded for use as
 * `Authorization: NTLM <value>`. Sent by the client to advertise its
 * capabilities and trigger the server's challenge response.
 */
export function buildNtlmType1Negotiate(domain: string, workstation: string): string {
  return base64Encode(buildNtlmType1NegotiateBytes(domain, workstation));
}

/**
 * base64-decode an NTLM message into raw bytes. Exposed for engines that
 * recover Type-1 / Type-2 byte buffers from previously-sent / received
 * `Authorization` / `WWW-Authenticate` headers (the MIC computation
 * needs the raw bytes, not the base64 form).
 */
export function decodeNtlmBase64(value: string): Uint8Array {
  return base64Decode(value);
}

export interface NtlmType2Challenge {
  /** 8-byte server challenge nonce. */
  challenge: Uint8Array;
  /**
   * Variable-length AV_PAIR target-info block. Echoed verbatim in the
   * Type-3 NTLMv2 blob so the server can verify the response.
   */
  targetInfo: Uint8Array;
  /**
   * Original raw bytes of the entire Type-2 message — required when the
   * caller wants to compute a MIC over `Type1 || Type2 || Type3` per
   * [MS-NLMP] §3.1.5.1.2. Set automatically by `parseNtlmType2Challenge`.
   * Optional so callers constructing the challenge literal in tests can
   * skip it; MIC computation needs the parser-produced form.
   */
  rawBytes?: Uint8Array;
}

/**
 * Parse the Type-2 Challenge message extracted from the server's
 * `WWW-Authenticate: NTLM <base64>` reply. Returns the server challenge
 * + target info bytes that feed into Type-3 construction.
 */
export function parseNtlmType2Challenge(base64: string): NtlmType2Challenge {
  const bytes = base64Decode(base64);
  if (bytes.length < 48) {
    throw new Error('NTLM Type-2 message too short');
  }
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const challenge = bytes.slice(24, 32);
  // Target info security buffer at offset 40 (length, max-length, offset).
  const tiLen = v.getUint16(40, true);
  const tiOff = v.getUint32(44, true);
  const targetInfo =
    tiLen > 0 && tiOff + tiLen <= bytes.length
      ? bytes.slice(tiOff, tiOff + tiLen)
      : new Uint8Array(0);
  return { challenge, targetInfo, rawBytes: bytes };
}

export interface BuildNtlmType3Args {
  username: string;
  password: string;
  domain: string;
  workstation: string;
  challenge: NtlmType2Challenge;
  /** Override for the 8-byte client challenge — tests pass a fixed value. */
  clientChallenge?: Uint8Array;
  /** Override for the timestamp (ms since epoch) — tests pass a fixed value. */
  timestampMs?: number;
  /**
   * Raw bytes of the Type-1 Negotiate message we sent in the previous
   * round. When BOTH this and `type2Message` are provided, we emit a
   * 16-byte MIC at offset 72 of the Type-3 message and set MsvAvFlags
   * bit 0x2 in the AV_PAIR target info — required by hardened Win Server
   * 2019+ AD configurations per [MS-NLMP] §3.1.5.1.2. When either is
   * absent we preserve the legacy "no MIC" layout for back-compat with
   * older servers that reject the longer header.
   */
  type1Message?: Uint8Array;
  /** Raw bytes of the Type-2 Challenge message — paired with `type1Message`. */
  type2Message?: Uint8Array;
}

/**
 * Build the Type-3 Authenticate message (NTLMv2). Computes the NTLMv2
 * hash, the NTProofStr (HMAC-MD5 over server-challenge + blob), and
 * packs everything into the binary message format. Returns base64 for
 * use as `Authorization: NTLM <value>`.
 */
export function buildNtlmType3Authenticate(args: BuildNtlmType3Args): string {
  const { username, password, domain, workstation, challenge } = args;

  // NT hash = MD4(UTF-16LE(password)).
  const ntHash = md4(utf16le(password));

  // NTLMv2 hash = HMAC-MD5(NT hash, UTF-16LE(upper(username) + domain)).
  const identity = concat(utf16le(username.toUpperCase()), utf16le(domain));
  const ntlmV2Hash = hmacMd5(ntHash, identity);

  const clientChallenge = args.clientChallenge ?? randomBytes(8);

  // NTLMv2 blob — RFC 4178 / [MS-NLMP] §2.2.2.7.
  const ts = BigInt(args.timestampMs ?? Date.now()) * 10000n + 116444736000000000n;
  const tsBytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) tsBytes[i] = Number((ts >> BigInt(i * 8)) & 0xffn);

  // [MS-NLMP] §3.1.5.1.2 — when the server's target info doesn't already
  // include MsvAvTimestamp, we MUST inject one before the EOL marker so
  // hardened Win Server 2019+ AD configs accept the response. Servers
  // that already include their own timestamp take precedence, so we
  // only inject when absent. AvId 7 = MsvAvTimestamp (8-byte FILETIME).
  const withTimestamp = ensureTimestampAvPair(challenge.targetInfo, tsBytes);
  // When MIC is enabled (caller passed Type-1 + Type-2 bytes), we also
  // set MsvAvFlags bit 0x2 — [MS-NLMP] §2.2.2.1 — to advertise that this
  // Type-3 carries a MIC. AvId 6 = MsvAvFlags (4-byte little-endian).
  const emitMic = !!(args.type1Message && args.type2Message);
  const enrichedTargetInfo = emitMic
    ? ensureMsvAvFlagsBit(withTimestamp, 0x00000002)
    : withTimestamp;

  const blob = new Uint8Array(28 + enrichedTargetInfo.length);
  blob[0] = 1;
  blob[1] = 1; // signature
  // bytes 2-7 are reserved zero (already set by Uint8Array default).
  for (let i = 0; i < 8; i++) blob[8 + i] = tsBytes[i]!;
  for (let i = 0; i < 8; i++) blob[16 + i] = clientChallenge[i]!;
  // bytes 24-27 reserved zero.
  blob.set(enrichedTargetInfo, 28);

  // NTProofStr = HMAC-MD5(NTLMv2 hash, serverChallenge + blob).
  const proofInput = concat(challenge.challenge, blob);
  const ntProofStr = hmacMd5(ntlmV2Hash, proofInput);

  // NT response = NTProofStr || blob.
  const ntResponse = concat(ntProofStr, blob);

  const domainBytes = utf16le(domain);
  const userBytes = utf16le(username);
  const wsBytes = utf16le(workstation);
  const lmResponse = new Uint8Array(24); // empty LM response — NTLMv2 doesn't use LM.

  // Layout offsets — fixed header is 72 bytes (Signature..Version) without
  // MIC, 88 bytes when MIC is present (Version followed by 16-byte MIC).
  // [MS-NLMP] §2.2.1.3.
  const baseOff = emitMic ? 88 : 72;
  const domainOff = baseOff;
  const userOff = domainOff + domainBytes.length;
  const wsOff = userOff + userBytes.length;
  const lmOff = wsOff + wsBytes.length;
  const ntOff = lmOff + lmResponse.length;
  const totalLen = ntOff + ntResponse.length;

  const msg = new Uint8Array(totalLen);
  msg.set([78, 84, 76, 77, 83, 83, 80, 0]); // "NTLMSSP\0"
  writeLE32(msg, 8, 3); // type = 3

  writeSecurityBuffer(msg, 12, lmResponse.length, lmOff);
  writeSecurityBuffer(msg, 20, ntResponse.length, ntOff);
  writeSecurityBuffer(msg, 28, domainBytes.length, domainOff);
  writeSecurityBuffer(msg, 36, userBytes.length, userOff);
  writeSecurityBuffer(msg, 44, wsBytes.length, wsOff);
  writeLE32(msg, 60, NTLM_FLAGS);

  msg.set(domainBytes, domainOff);
  msg.set(userBytes, userOff);
  msg.set(wsBytes, wsOff);
  msg.set(lmResponse, lmOff);
  msg.set(ntResponse, ntOff);

  // MIC computation — [MS-NLMP] §3.1.5.1.2. Done last so the message body
  // is finalized before we hash it. The MIC field at offset 72-87 is
  // already zeroed (Uint8Array default), which is exactly what the spec
  // requires during hashing. We patch the computed MIC in place.
  //
  // For NTLMv2 without NEGOTIATE_KEY_EXCH (our flag set 0x00000207):
  //   SessionBaseKey   = HMAC-MD5(NTLMv2Hash, NTProofStr)
  //   KeyExchangeKey   = SessionBaseKey
  //   ExportedSessionKey = KeyExchangeKey  (no RC4 wrap — NEGOTIATE_KEY_EXCH absent)
  //   MIC = HMAC-MD5(ExportedSessionKey, Type1 || Type2 || Type3-zero-MIC)
  if (emitMic) {
    const sessionBaseKey = hmacMd5(ntlmV2Hash, ntProofStr);
    const concatenated = concat(concat(args.type1Message!, args.type2Message!), msg);
    const mic = hmacMd5(sessionBaseKey, concatenated);
    for (let i = 0; i < 16; i++) msg[72 + i] = mic[i]!;
  }

  return base64Encode(msg);
}

// ── helpers ────────────────────────────────────────────────────────────────────

/**
 * AV_PAIR walker — scans `targetInfo` for an existing MsvAvTimestamp
 * (AvId 7). If found, leaves it alone (the server's value wins). If
 * absent, splices in `[AvId=7][AvLen=8][8 bytes timestamp]` immediately
 * before the EOL pair (AvId 0, AvLen 0).
 */
function ensureTimestampAvPair(targetInfo: Uint8Array, tsBytes: Uint8Array): Uint8Array {
  // Empty target info — emit timestamp + EOL.
  if (targetInfo.length === 0) {
    const out = new Uint8Array(12 + 4);
    writeLE16(out, 0, 7); // AvId = MsvAvTimestamp
    writeLE16(out, 2, 8); // AvLen = 8
    for (let i = 0; i < 8; i++) out[4 + i] = tsBytes[i]!;
    // EOL pair at the tail.
    return out;
  }

  // Walk pairs to look for AvId=7. Each pair: 2-byte AvId, 2-byte AvLen,
  // AvLen bytes of value. AvId 0 (EOL) terminates.
  let cursor = 0;
  let eolOffset = -1;
  let hasTimestamp = false;
  while (cursor + 4 <= targetInfo.length) {
    const avId = targetInfo[cursor] | (targetInfo[cursor + 1] << 8);
    const avLen = targetInfo[cursor + 2] | (targetInfo[cursor + 3] << 8);
    if (avId === 0) {
      eolOffset = cursor;
      break;
    }
    if (avId === 7) hasTimestamp = true;
    cursor += 4 + avLen;
  }

  if (hasTimestamp) return targetInfo;
  if (eolOffset < 0) {
    // Malformed — no EOL. Append timestamp + EOL conservatively.
    const out = new Uint8Array(targetInfo.length + 12 + 4);
    out.set(targetInfo);
    writeLE16(out, targetInfo.length, 7);
    writeLE16(out, targetInfo.length + 2, 8);
    for (let i = 0; i < 8; i++) out[targetInfo.length + 4 + i] = tsBytes[i]!;
    return out;
  }

  // Splice timestamp pair in before the EOL.
  const out = new Uint8Array(targetInfo.length + 12);
  out.set(targetInfo.subarray(0, eolOffset));
  writeLE16(out, eolOffset, 7);
  writeLE16(out, eolOffset + 2, 8);
  for (let i = 0; i < 8; i++) out[eolOffset + 4 + i] = tsBytes[i]!;
  out.set(targetInfo.subarray(eolOffset), eolOffset + 12);
  return out;
}

/**
 * AV_PAIR walker — sets bits in the MsvAvFlags pair (AvId 6, AvLen 4).
 * Inserts a fresh pair before the EOL marker if absent. Used to advertise
 * MIC presence (`bit 0x2`) per [MS-NLMP] §2.2.2.1.
 *
 * Assumes `targetInfo` ends with the EOL pair (AvId=0, AvLen=0). Callers
 * pass timestamp-enriched target info — `ensureTimestampAvPair` already
 * enforces a well-formed EOL.
 */
function ensureMsvAvFlagsBit(targetInfo: Uint8Array, bit: number): Uint8Array {
  let cursor = 0;
  let eolOffset = -1;
  let flagsOffset = -1;
  while (cursor + 4 <= targetInfo.length) {
    const avId = targetInfo[cursor] | (targetInfo[cursor + 1] << 8);
    const avLen = targetInfo[cursor + 2] | (targetInfo[cursor + 3] << 8);
    if (avId === 0) {
      eolOffset = cursor;
      break;
    }
    if (avId === 6 && avLen === 4) flagsOffset = cursor + 4;
    cursor += 4 + avLen;
  }

  if (flagsOffset >= 0) {
    // OR our bit into the existing 4-byte LE flags value.
    const existing =
      targetInfo[flagsOffset] |
      (targetInfo[flagsOffset + 1] << 8) |
      (targetInfo[flagsOffset + 2] << 16) |
      (targetInfo[flagsOffset + 3] << 24);
    const merged = (existing | bit) >>> 0;
    const out = new Uint8Array(targetInfo);
    writeLE32(out, flagsOffset, merged);
    return out;
  }

  // No MsvAvFlags pair — splice a new one before EOL (or append if EOL
  // somehow absent). 8 bytes total: 2-byte AvId, 2-byte AvLen, 4-byte value.
  if (eolOffset < 0) {
    const out = new Uint8Array(targetInfo.length + 8 + 4);
    out.set(targetInfo);
    writeLE16(out, targetInfo.length, 6);
    writeLE16(out, targetInfo.length + 2, 4);
    writeLE32(out, targetInfo.length + 4, bit);
    return out;
  }
  const out = new Uint8Array(targetInfo.length + 8);
  out.set(targetInfo.subarray(0, eolOffset));
  writeLE16(out, eolOffset, 6);
  writeLE16(out, eolOffset + 2, 4);
  writeLE32(out, eolOffset + 4, bit);
  out.set(targetInfo.subarray(eolOffset), eolOffset + 8);
  return out;
}

function utf16le(str: string): Uint8Array {
  const buf = new Uint8Array(str.length * 2);
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    buf[i * 2] = c & 0xff;
    buf[i * 2 + 1] = (c >> 8) & 0xff;
  }
  return buf;
}

function writeLE32(buf: Uint8Array, off: number, v: number): void {
  buf[off] = v & 0xff;
  buf[off + 1] = (v >> 8) & 0xff;
  buf[off + 2] = (v >> 16) & 0xff;
  buf[off + 3] = (v >> 24) & 0xff;
}

function writeLE16(buf: Uint8Array, off: number, v: number): void {
  buf[off] = v & 0xff;
  buf[off + 1] = (v >> 8) & 0xff;
}

/** Length, allocated-length, offset triple per `[MS-NLMP]` security buffer layout. */
function writeSecurityBuffer(
  buf: Uint8Array,
  off: number,
  length: number,
  payloadOff: number,
): void {
  writeLE16(buf, off, length);
  writeLE16(buf, off + 2, length);
  writeLE32(buf, off + 4, payloadOff);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

function base64Encode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64Decode(s: string): Uint8Array {
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

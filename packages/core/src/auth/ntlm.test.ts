import { describe, expect, it } from 'vitest';
import {
  buildNtlmType1Negotiate,
  buildNtlmType1NegotiateBytes,
  buildNtlmType3Authenticate,
  decodeNtlmBase64,
  parseNtlmType2Challenge,
} from './ntlm';
import { hmacMd5, md4 } from './_legacyHashes';

const HEADER = [78, 84, 76, 77, 83, 83, 80, 0]; // "NTLMSSP\0"

function decode(b64: string): Uint8Array {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function readLE32(buf: Uint8Array, off: number): number {
  return (buf[off]! | (buf[off + 1]! << 8) | (buf[off + 2]! << 16) | (buf[off + 3]! << 24)) >>> 0;
}

// Local mirrors of the production helpers — used by the MIC test to
// re-derive the expected MIC from inputs, anchoring the assertion.
function utf16leLocal(s: string): Uint8Array {
  const buf = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    buf[i * 2] = c & 0xff;
    buf[i * 2 + 1] = (c >> 8) & 0xff;
  }
  return buf;
}
function concatLocal(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

describe('buildNtlmType1Negotiate', () => {
  it('starts with the NTLMSSP signature and message-type 1', () => {
    const bytes = decode(buildNtlmType1Negotiate('CORP', 'CLIENT01'));
    expect(Array.from(bytes.slice(0, 8))).toEqual(HEADER);
    expect(readLE32(bytes, 8)).toBe(1);
  });

  it('uppercases domain and workstation in the embedded payload', () => {
    const bytes = decode(buildNtlmType1Negotiate('corp', 'client01'));
    // Workstation payload starts at fixed offset 32 per our layout.
    const wsLen = bytes[24]! | (bytes[25]! << 8);
    const wsBytes = bytes.slice(32, 32 + wsLen);
    // UTF-16LE → take every other byte to recover ASCII.
    const wsAscii = Array.from(wsBytes.filter((_, i) => i % 2 === 0))
      .map((b) => String.fromCharCode(b))
      .join('');
    expect(wsAscii).toBe('CLIENT01');
  });
});

describe('parseNtlmType2Challenge', () => {
  it('extracts the 8-byte server challenge at offset 24', () => {
    // Hand-crafted Type-2 with a known challenge and empty target info.
    const buf = new Uint8Array(48);
    buf.set(HEADER);
    // type = 2
    buf[8] = 2;
    // Server challenge at 24-31.
    const expectedChallenge = [0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef];
    for (let i = 0; i < 8; i++) buf[24 + i] = expectedChallenge[i]!;
    // Target info security buffer at offset 40 — zero-length.
    const b64 = btoa(String.fromCharCode(...buf));
    const out = parseNtlmType2Challenge(b64);
    expect(Array.from(out.challenge)).toEqual(expectedChallenge);
    expect(out.targetInfo.length).toBe(0);
  });

  it('throws when the message is too short to contain a Type-2 header', () => {
    expect(() => parseNtlmType2Challenge(btoa('NTLMSSP'))).toThrow(/too short/i);
  });

  it('extracts the AV_PAIR target-info block', () => {
    const targetInfo = new Uint8Array([0x02, 0x00, 0x04, 0x00, 0x44, 0x00, 0x4f, 0x00]); // sample
    const buf = new Uint8Array(48 + targetInfo.length);
    buf.set(HEADER);
    buf[8] = 2;
    // Target info at offset 48 with length = 8.
    buf[40] = targetInfo.length;
    buf[44] = 48;
    buf.set(targetInfo, 48);
    const out = parseNtlmType2Challenge(btoa(String.fromCharCode(...buf)));
    expect(Array.from(out.targetInfo)).toEqual(Array.from(targetInfo));
  });
});

describe('buildNtlmType3Authenticate', () => {
  // A deterministic Type-3 message — fixed timestamp + client challenge so
  // the resulting NTProofStr is stable. Validates round-trip shape;
  // hand-derived from running the algorithm once with known inputs.
  it('produces a well-formed Type-3 message with stable layout', () => {
    const challenge = {
      challenge: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      targetInfo: new Uint8Array(0),
    };
    const b64 = buildNtlmType3Authenticate({
      username: 'alice',
      password: 'hunter2',
      domain: 'CORP',
      workstation: 'WS01',
      challenge,
      clientChallenge: new Uint8Array([9, 10, 11, 12, 13, 14, 15, 16]),
      timestampMs: 1700000000000,
    });
    const bytes = decode(b64);
    expect(Array.from(bytes.slice(0, 8))).toEqual(HEADER);
    expect(readLE32(bytes, 8)).toBe(3);

    // LM response is empty 24-byte stub.
    const lmLen = bytes[12]! | (bytes[13]! << 8);
    expect(lmLen).toBe(24);

    // NT response = 16-byte NTProofStr + blob. Blob = 28 fixed header +
    // enriched target info. Empty server target info gets the injected
    // MsvAvTimestamp pair (12 bytes) + EOL pair (4 bytes) = 16 bytes.
    const ntLen = bytes[20]! | (bytes[21]! << 8);
    expect(ntLen).toBe(16 + 28 + 16);

    // Domain / username / workstation are encoded UTF-16LE — verify length.
    const domainLen = bytes[28]! | (bytes[29]! << 8);
    const userLen = bytes[36]! | (bytes[37]! << 8);
    const wsLen = bytes[44]! | (bytes[45]! << 8);
    expect(domainLen).toBe('CORP'.length * 2);
    expect(userLen).toBe('alice'.length * 2);
    expect(wsLen).toBe('WS01'.length * 2);
  });

  it('changes the NTProofStr when the password changes', () => {
    const challenge = {
      challenge: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      targetInfo: new Uint8Array(0),
    };
    const baseArgs = {
      username: 'alice',
      domain: 'CORP',
      workstation: 'WS01',
      challenge,
      clientChallenge: new Uint8Array([9, 10, 11, 12, 13, 14, 15, 16]),
      timestampMs: 1700000000000,
    };
    const a = decode(buildNtlmType3Authenticate({ ...baseArgs, password: 'hunter2' }));
    const b = decode(buildNtlmType3Authenticate({ ...baseArgs, password: 'different' }));
    // NT response starts 16 bytes after offset given in security buffer at 24-27.
    const ntOff = readLE32(a, 24);
    const aProof = Array.from(a.slice(ntOff, ntOff + 16));
    const bProof = Array.from(b.slice(ntOff, ntOff + 16));
    expect(aProof).not.toEqual(bProof);
  });

  it('injects MsvAvTimestamp (AvId 7) when the server-supplied target info lacks one', () => {
    // Target info without AvId 7, terminated by EOL pair (AvId 0, AvLen 0).
    // [02 00 04 00 'D' 00 'O' 00 00 00 00 00] — domain name pair + EOL.
    const targetInfo = new Uint8Array([
      0x02, 0x00, 0x04, 0x00, 0x44, 0x00, 0x4f, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    const b64 = buildNtlmType3Authenticate({
      username: 'a',
      password: 'p',
      domain: 'D',
      workstation: 'W',
      challenge: { challenge: new Uint8Array(8), targetInfo },
      clientChallenge: new Uint8Array(8),
      timestampMs: 0,
    });
    const bytes = decode(b64);
    const ntOff = readLE32(bytes, 24);
    const ntLen = bytes[20]! | (bytes[21]! << 8);
    const ntResp = bytes.slice(ntOff, ntOff + ntLen);
    const blobTargetInfo = ntResp.slice(16 + 28); // skip NTProofStr + fixed blob header

    // Walk AV_PAIRs, expect AvId=7 to be present somewhere before EOL.
    let cursor = 0;
    let foundTimestamp = false;
    while (cursor + 4 <= blobTargetInfo.length) {
      const avId = blobTargetInfo[cursor]! | (blobTargetInfo[cursor + 1]! << 8);
      const avLen = blobTargetInfo[cursor + 2]! | (blobTargetInfo[cursor + 3]! << 8);
      if (avId === 0) break;
      if (avId === 7) {
        foundTimestamp = true;
        expect(avLen).toBe(8);
      }
      cursor += 4 + avLen;
    }
    expect(foundTimestamp).toBe(true);
  });

  it('respects a server-supplied MsvAvTimestamp without overriding it', () => {
    // Build target info with AvId=7 (8-byte timestamp = 0xAA repeated) + EOL.
    const targetInfo = new Uint8Array([
      0x07, 0x00, 0x08, 0x00, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0x00, 0x00, 0x00,
      0x00,
    ]);
    const b64 = buildNtlmType3Authenticate({
      username: 'a',
      password: 'p',
      domain: 'D',
      workstation: 'W',
      challenge: { challenge: new Uint8Array(8), targetInfo },
      clientChallenge: new Uint8Array(8),
      timestampMs: 0,
    });
    const bytes = decode(b64);
    const ntOff = readLE32(bytes, 24);
    const ntLen = bytes[20]! | (bytes[21]! << 8);
    const blobTargetInfo = bytes.slice(ntOff + 16 + 28, ntOff + ntLen);
    // Server-supplied timestamp bytes must still be 0xAA — we didn't overwrite.
    expect(Array.from(blobTargetInfo.slice(4, 12))).toEqual([
      0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa,
    ]);
  });

  it('emits a 16-byte MIC at offset 72 when type1+type2 bytes are provided', () => {
    // Deterministic inputs so the MIC is stable across runs.
    const username = 'alice';
    const password = 'hunter2';
    const domain = 'CORP';
    const workstation = 'WS01';
    const clientChallenge = new Uint8Array([9, 10, 11, 12, 13, 14, 15, 16]);
    const timestampMs = 1700000000000;

    const type1Bytes = buildNtlmType1NegotiateBytes(domain, workstation);

    // Hand-craft a Type-2 with a known challenge + EOL-only target info
    // so we can assert exact MIC bytes deterministically.
    const t2 = new Uint8Array(48);
    t2.set([78, 84, 76, 77, 83, 83, 80, 0]);
    t2[8] = 2;
    const serverChallenge = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    t2.set(serverChallenge, 24);
    // Target info security buffer at 40: zero-length.
    const t2Parsed = parseNtlmType2Challenge(btoa(String.fromCharCode(...t2)));

    const b64 = buildNtlmType3Authenticate({
      username,
      password,
      domain,
      workstation,
      challenge: t2Parsed,
      clientChallenge,
      timestampMs,
      type1Message: type1Bytes,
      type2Message: t2Parsed.rawBytes,
    });
    const type3Bytes = decode(b64);

    // Header still well-formed.
    expect(Array.from(type3Bytes.slice(0, 8))).toEqual(HEADER);
    expect(readLE32(type3Bytes, 8)).toBe(3);

    // Payload starts at 88 (Version[64..71] + MIC[72..87]) when MIC is present.
    const domainOff = readLE32(type3Bytes, 32);
    expect(domainOff).toBe(88);

    // The MIC bytes must be non-zero (proves we actually wrote them).
    const mic = type3Bytes.slice(72, 88);
    expect(mic.every((b) => b === 0)).toBe(false);
    expect(mic.length).toBe(16);

    // Re-derive the expected MIC and compare. This anchors the
    // computation against the documented algorithm.
    const ntHash = md4(utf16leLocal(password));
    const ntlmV2Hash = hmacMd5(
      ntHash,
      concatLocal(utf16leLocal(username.toUpperCase()), utf16leLocal(domain)),
    );
    // Recover NTProofStr from the message: NT response starts with 16-byte NTProofStr.
    const ntOff = readLE32(type3Bytes, 24);
    const ntProofStr = type3Bytes.slice(ntOff, ntOff + 16);
    const sessionBaseKey = hmacMd5(ntlmV2Hash, ntProofStr);

    // Build the zeroed-MIC variant (current type3Bytes already has the
    // computed MIC; reset to zero for the hash input).
    const zeroed = new Uint8Array(type3Bytes);
    for (let i = 72; i < 88; i++) zeroed[i] = 0;
    const expectedMic = hmacMd5(
      sessionBaseKey,
      concatLocal(concatLocal(type1Bytes, t2Parsed.rawBytes!), zeroed),
    );
    expect(Array.from(mic)).toEqual(Array.from(expectedMic));
  });

  it('sets MsvAvFlags bit 0x2 in the target info when emitting a MIC', () => {
    const type1Bytes = buildNtlmType1NegotiateBytes('D', 'W');
    const t2 = new Uint8Array(48);
    t2.set([78, 84, 76, 77, 83, 83, 80, 0]);
    t2[8] = 2;
    const t2Parsed = parseNtlmType2Challenge(btoa(String.fromCharCode(...t2)));

    const b64 = buildNtlmType3Authenticate({
      username: 'a',
      password: 'p',
      domain: 'D',
      workstation: 'W',
      challenge: t2Parsed,
      clientChallenge: new Uint8Array(8),
      timestampMs: 0,
      type1Message: type1Bytes,
      type2Message: t2Parsed.rawBytes,
    });
    const bytes = decode(b64);
    const ntOff = readLE32(bytes, 24);
    const ntLen = bytes[20]! | (bytes[21]! << 8);
    const blobTargetInfo = bytes.slice(ntOff + 16 + 28, ntOff + ntLen);

    let foundFlags = false;
    let cursor = 0;
    while (cursor + 4 <= blobTargetInfo.length) {
      const avId = blobTargetInfo[cursor]! | (blobTargetInfo[cursor + 1]! << 8);
      const avLen = blobTargetInfo[cursor + 2]! | (blobTargetInfo[cursor + 3]! << 8);
      if (avId === 0) break;
      if (avId === 6 && avLen === 4) {
        foundFlags = true;
        const value =
          blobTargetInfo[cursor + 4]! |
          (blobTargetInfo[cursor + 5]! << 8) |
          (blobTargetInfo[cursor + 6]! << 16) |
          (blobTargetInfo[cursor + 7]! << 24);
        expect(value & 0x2).toBe(0x2);
      }
      cursor += 4 + avLen;
    }
    expect(foundFlags).toBe(true);
  });

  it('decodeNtlmBase64 round-trips the bytes', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5]);
    const b64 = btoa(String.fromCharCode(...original));
    const decoded = decodeNtlmBase64(b64);
    expect(Array.from(decoded)).toEqual([1, 2, 3, 4, 5]);
  });

  it('preserves server-supplied AV_PAIRs verbatim alongside injected timestamp', () => {
    // Valid AV_PAIR sequence: domain-name pair + computer-name pair + EOL.
    const targetInfo = new Uint8Array([
      0x02,
      0x00,
      0x04,
      0x00,
      0x44,
      0x00,
      0x4f,
      0x00, // AvId=2 (domain), AvLen=4, "DO" UTF-16LE
      0x03,
      0x00,
      0x04,
      0x00,
      0x57,
      0x00,
      0x53,
      0x00, // AvId=3 (computer), AvLen=4, "WS" UTF-16LE
      0x00,
      0x00,
      0x00,
      0x00, // EOL
    ]);
    const b64 = buildNtlmType3Authenticate({
      username: 'alice',
      password: 'p',
      domain: 'D',
      workstation: 'W',
      challenge: { challenge: new Uint8Array(8), targetInfo },
      clientChallenge: new Uint8Array(8),
      timestampMs: 0,
    });
    const bytes = decode(b64);
    const ntOff = readLE32(bytes, 24);
    const ntLen = bytes[20]! | (bytes[21]! << 8);
    const blobTargetInfo = bytes.slice(ntOff + 16 + 28, ntOff + ntLen);
    // Original AV_PAIRs (16 bytes) sit at the front; injected MsvAvTimestamp
    // pair (12 bytes) sits between them and the EOL (4 bytes).
    expect(blobTargetInfo.length).toBe(16 + 12 + 4);
    expect(Array.from(blobTargetInfo.slice(0, 16))).toEqual(Array.from(targetInfo.slice(0, 16)));
  });
});

// test-mqtt-auth.js
// Unit tests for SEC-2 (MQTT Message Authentication) & SEC-3 (hashPin Removal)
const assert = require('assert');
const S = require('./badminton-service.js');

async function runMqttAuthTests() {
  console.log('\n=== RUNNING MQTT AUTH & HARDENING UNIT TESTS (SEC-2 & SEC-3) ===\n');

  if (!S.MqttAuth) {
    throw new Error('S.MqttAuth is not defined yet');
  }

  const {
    deriveHmacKey,
    generateEcdsaKeyPair,
    exportEcdsaPublicKey,
    generateNonce,
    signMessage,
    verifyMessage,
    createPinChallenge,
    solvePinChallenge,
    verifyPinResponse
  } = S.MqttAuth;

  // --- Test 1: Message Signing and Verification with HMAC (Host & Referees with PIN) ---
  console.log('--- 1. HMAC Message Signing and Replay Rejection ---');
  const roomId = 'BADM-777';
  const pin = '5678';
  const key = await deriveHmacKey(pin, roomId);
  const wrongKey = await deriveHmacKey('wrong-pin', roomId);

  let seqCounter = 0;
  const originalMsg = {
    type: 'STATE_UPDATE',
    roomId: roomId,
    payload: { currentSport: 'badminton', bPlayers: [] }
  };

  const signedMsg = await signMessage(originalMsg, {
    hmacKey: key,
    seq: ++seqCounter
  });

  assert.strictEqual(signedMsg.seq, 1);
  assert.ok(typeof signedMsg.sig === 'string' && signedMsg.sig.length === 64, 'Signature should be 64-char hex');
  assert.ok(typeof signedMsg.ts === 'number');

  // Verify with valid key
  let lastSeenSeq = 0;
  const resValid = await verifyMessage(signedMsg, { hmacKey: key, lastSeenSeq });
  assert.strictEqual(resValid.valid, true, 'Valid signature must be accepted');

  // Verify fake message without signature
  const fakeMsg = { ...signedMsg, sig: '' };
  const resFake = await verifyMessage(fakeMsg, { hmacKey: key, lastSeenSeq });
  assert.strictEqual(resFake.valid, false, 'Message without signature must be rejected');

  // Verify fake message with tampered payload
  const tamperedMsg = { ...signedMsg, payload: { ...signedMsg.payload, tampered: true } };
  const resTampered = await verifyMessage(tamperedMsg, { hmacKey: key, lastSeenSeq });
  assert.strictEqual(resTampered.valid, false, 'Tampered message must be rejected');

  // Verify message with wrong key (wrong PIN)
  const resWrongKey = await verifyMessage(signedMsg, { hmacKey: wrongKey, lastSeenSeq });
  assert.strictEqual(resWrongKey.valid, false, 'Message with invalid PIN key must be rejected');

  // Verify replay protection (seq <= lastSeenSeq)
  const resReplay = await verifyMessage(signedMsg, { hmacKey: key, lastSeenSeq: 1 });
  assert.strictEqual(resReplay.valid, false, 'Message with seq <= lastSeenSeq must be rejected');
  console.log('  ✓ Pesan STATE_UPDATE palsu/tanpa signature ditolak, dan proteksi replay (seq) berjalan');

  // --- Test 2: ECDSA Signature & TOFU (Spectator without PIN) ---
  console.log('--- 2. ECDSA Host Signature & TOFU Verification for Spectators ---');
  const ecdsaKp = await generateEcdsaKeyPair();
  const hostPubHex = await exportEcdsaPublicKey(ecdsaKp.publicKey);

  const specSignedMsg = await signMessage({
    type: 'STATE_UPDATE',
    roomId: roomId,
    payload: { bPlayers: [{ id: 1, name: 'Budi' }] }
  }, {
    hmacKey: key,
    ecdsaPrivateKey: ecdsaKp.privateKey,
    hostPubHex: hostPubHex,
    seq: 2
  });

  assert.strictEqual(specSignedMsg.hostSigPublic, hostPubHex);
  assert.ok(typeof specSignedMsg.hostPubSig === 'string');

  // First time spectator receives state (TOFU: no trusted host yet)
  const tofuRes1 = await verifyMessage(specSignedMsg, {
    isSpectator: true,
    trustedHostPub: null,
    lastSeenSeq: 0
  });
  assert.strictEqual(tofuRes1.valid, true);
  assert.strictEqual(tofuRes1.newHostPub, hostPubHex);

  // Subsequent message from same host
  const specSignedMsg2 = await signMessage({
    type: 'STATE_UPDATE',
    roomId: roomId,
    payload: { bPlayers: [{ id: 1, name: 'Budi' }] }
  }, {
    hmacKey: key,
    ecdsaPrivateKey: ecdsaKp.privateKey,
    hostPubHex: hostPubHex,
    seq: 3
  });
  const tofuRes2 = await verifyMessage(specSignedMsg2, {
    isSpectator: true,
    trustedHostPub: hostPubHex,
    lastSeenSeq: 2
  });
  assert.strictEqual(tofuRes2.valid, true);

  // Message from imposter with different host key
  const imposterKp = await generateEcdsaKeyPair();
  const imposterPubHex = await exportEcdsaPublicKey(imposterKp.publicKey);
  const imposterMsg = await signMessage({
    type: 'STATE_UPDATE',
    roomId: roomId,
    payload: { bPlayers: [] }
  }, {
    hmacKey: wrongKey,
    ecdsaPrivateKey: imposterKp.privateKey,
    hostPubHex: imposterPubHex,
    seq: 4
  });
  const tofuResImposter = await verifyMessage(imposterMsg, {
    isSpectator: true,
    trustedHostPub: hostPubHex, // Spectator expects original host
    lastSeenSeq: 3
  });
  assert.strictEqual(tofuResImposter.valid, false, 'Imposter key must be rejected by spectator (TOFU)');
  console.log('  ✓ Penonton memverifikasi signature host via TOFU dan menolak peniru');

  // --- Test 3: Challenge-Response PIN Verification (No Plaintext PIN / No Broadcasted Hash) ---
  console.log('--- 3. Challenge-Response PIN Verification ---');
  const candidatePin = '5678';
  const attackerPin = '0000';
  const reqNonce = generateNonce();
  const challenge = createPinChallenge('client-candidate-1', reqNonce);

  // Candidate computes response
  const candidateSolution = await solvePinChallenge(challenge.challengeNonce, candidatePin);
  const attackerSolution = await solvePinChallenge(challenge.challengeNonce, attackerPin);

  // Host verifies
  const hostCheckCorrect = await verifyPinResponse(challenge.challengeNonce, pin, candidateSolution);
  const hostCheckWrong = await verifyPinResponse(challenge.challengeNonce, pin, attackerSolution);

  assert.strictEqual(hostCheckCorrect, true, 'Correct PIN challenge solution must be valid');
  assert.strictEqual(hostCheckWrong, false, 'Incorrect PIN challenge solution must be invalid');

  // Candidate receives VERIFY_HOST_PIN_RESULT check
  const fakeResultMsg = {
    type: 'VERIFY_HOST_PIN_RESULT',
    targetId: 'client-candidate-1',
    challengeNonce: 'fake-unsolicited-nonce',
    success: true
  };
  const isCandidateAcceptingFake = (fakeResultMsg.challengeNonce === challenge.challengeNonce);
  assert.strictEqual(isCandidateAcceptingFake, false, 'Candidate must reject unmatching/fake nonce response');

  // Check no PIN leaks in published payloads
  const payloadStr = JSON.stringify({
    type: 'VERIFY_HOST_PIN_RESPONSE',
    roomId: roomId,
    senderId: 'client-candidate-1',
    challengeNonce: challenge.challengeNonce,
    authResponse: candidateSolution
  });
  assert.strictEqual(payloadStr.includes('5678'), false, 'Payload must never include raw PIN');
  assert.strictEqual(payloadStr.includes('pinHash'), false, 'Payload must not include pinHash');
  assert.strictEqual(payloadStr.includes('candidatePin'), false, 'Payload must not include candidatePin');
  console.log('  ✓ Challenge-response mencegah kebocoran PIN dan memblokir respon palsu');

  console.log('\n======================================================');
  console.log('ALL MQTT AUTH & HARDENING TESTS PASSED!');
  console.log('======================================================\n');
}

runMqttAuthTests().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});

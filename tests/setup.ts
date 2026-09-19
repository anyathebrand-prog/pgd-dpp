import 'dotenv/config';

// The webhook receiver verifies HMAC SHA512 against this. The simulated
// checkout signs with the same value, so the signature path under test is the
// real one rather than a bypass.
process.env.PAYSTACK_SECRET_KEY ??= 'sk_test_simulated';
process.env.SESSION_SECRET ??= 'test-secret-not-used-in-production';

# Credential encryption rollout

New records use AES-256-GCM with a random nonce and authentication tag. Reads retain compatibility with existing `iv:ciphertext` CBC records under the same configured key. Missing, malformed and all-zero encryption keys are rejected. Existing keys must not be replaced as part of deploying this change.

## Deployment gates

- Verify that this repository matches the deployed Midas backend. The recorded Vercel project has no Git source link.
- Verify the existing encryption key through the deployment secret manager. The audit inspected environment variable names only.
- Back up the credential table and test a restore in an isolated database.
- Deploy the compatible reader before migrating records. Once new credentials are saved, the old application version cannot read them.
- With the existing key and intended database configured, run `node scripts/migrate-credentials.js` for a dry run. It prints counts only. Any unreadable credential aborts the transaction.
- Apply with `node scripts/migrate-credentials.js --apply` only after the gates pass. The transaction converts both credential columns and preserves null secrets and existing GCM records. Verify wallet access and provider access without placing trades.

CBC has no authenticity check: successful decryption alone cannot prove that historical records were never modified. If the old public fallback key was ever used, rotate the affected provider credentials and reconnect them securely. Do not enable fallback-key reads.

Rollback must retain a reader for the GCM format. Do not roll back to the old encryption module after any GCM writes. Restore the tested database backup only through a coordinated recovery that accounts for subsequent credential changes.

No live migration, secret rotation, trading action, deployment or provider call was performed by these tests.

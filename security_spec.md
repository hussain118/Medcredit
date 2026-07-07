# Security Specification - AsquafMedical Firestore Security

This document outlines the strict ABAC security parameters, data invariants, and negative test-cases ("Dirty Dozen") designed to protect user identity and ledger integrity in AsquafMedical.

## Data Invariants

1. **User Isolation**: A user can only read, create, update, or delete records and settings under their own `/users/{userId}/` sub-path.
2. **Identifier Integrity**: The ID of records and parent paths must correspond strictly to clean formatted strings (`isValidId()`).
3. **Temporal Integrity**: Creation and modification timestamps, if present, are anchored to `request.time`.
4. **Immutability**: Immutable fields like `id`, `type`, and of course the path parameter `userId` cannot be modified during update.
5. **Verified Email constraint**: For all updates and creations, users must have a verified Google email signature when accessing cloud storage (`request.auth.token.email_verified == true`).

## The "Dirty Dozen" Vulnerabilities Blocked

The following payload attempts will be flatly rejected (`PERMISSION_DENIED`):

1. **Malicious Read**: Authenticated user `Alice` trying to list files or records in `Bob`'s ledger: `/users/bob/records/`.
2. **Identity Spoofing**: User `Alice` trying to create a record under Bob's layout with `authorId = "bob"`.
3. **Ghost Fields injection**: Inserting extraneous fields (`isVIP: true`) to bypass strict key validation schemas.
4. **Invalid Type Poisoning**: Sending `amount: "ten thousand"` as a string instead of a valid positive double float.
5. **Excessive Field Length (Denial of Wallet)**: Submitting a `customerName` of 5 megabytes to exhaust index nodes.
6. **Malicious ID (ID Poisoning)**: Creating a record with document ID containing illegal slash characters, shell injection codes, or emojis.
7. **Bypassing Verification Status**: Trying to write or sign setting documents with an email that is not verified (`email_verified == false`).
8. **Alter Record Type**: Updating an existing customer record to turn it into a supplier record (`type: "supplier"` after being `"customer"`).
9. **Alter Record ID**: Modifying the unique `id` of an existing active ledger record.
10. **State Shortcutting**: Overwriting a locked `paid` ledger status back to arbitrary unpaid states without correct schema matching.
11. **Spoofed Pharmacy Settings**: Authenticated attacker writing pharmacy settings into another user's path.
12. **Blanket Collection Querying**: Client attempting to download all records in the global collection without constraining queries to their own UID.

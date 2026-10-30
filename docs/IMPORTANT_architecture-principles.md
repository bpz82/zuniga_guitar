# IMPORTANT: Zuniga Guitar Architecture Principles (Blake, Oct 30 2026)
Source: Heather Adkins (Google), "Building Secure and Reliable Systems at Scale". MANDATORY alongside IMPORTANT_design-spec-sheet.txt, and checked in every design check before every build.

1. Failure isolation: modules are separate failure domains that reach the engine only through the module contract. One module crashing never breaks the engine or other modules.
2. Validate consequential actions: the engine rejects malformed events and writes that are too broad. No update or delete paths on the log.
3. Design for recovery: the append-only log rebuilds all state, backups and export exist, and a bad deploy rolls back through GitHub in minutes.
4. Don't overbuild: isolation must justify its complexity. One simple codebase with clear module boundaries, not microservices.
5. Least privilege: each module gets only the data access it needs, Supabase row-level security is on, and no secrets go in client code.
6. Secure defaults that don't add friction for Blake.

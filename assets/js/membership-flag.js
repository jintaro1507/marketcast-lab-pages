// Marketcast Pause Preflight: single source of truth for membership suspension.
// Not an ES module — loads synchronously in <head>, before any Supabase-dependent
// script, and has zero network/import dependency of its own. This guarantees the
// suspension banner and gated-element hiding work even if Supabase is unreachable.
//
// To resume membership features, flip this single value back to false.
window.MEMBERSHIP_SUSPENDED = false;

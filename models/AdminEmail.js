import { pool } from "../config/database.js";

export async function getAdminEmailOverview() {
  const [summaryResult, recentResult] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*)::INTEGER AS total,

         COUNT(*) FILTER (
           WHERE status = 'pending'
         )::INTEGER AS pending,

         COUNT(*) FILTER (
           WHERE status = 'sending'
         )::INTEGER AS sending,

         COUNT(*) FILTER (
           WHERE status = 'sent'
         )::INTEGER AS sent,

         COUNT(*) FILTER (
           WHERE status = 'failed'
         )::INTEGER AS failed,

         COUNT(*) FILTER (
           WHERE status = 'review_required'
         )::INTEGER AS review_required,

         COUNT(*) FILTER (
           WHERE status = 'sending'
             AND claimed_at < NOW() - INTERVAL '5 minutes'
         )::INTEGER AS stalled,

         COUNT(*) FILTER (
           WHERE is_demo
         )::INTEGER AS demo

       FROM email_outbox`,
    ),

    pool.query(
      `SELECT
         e.id,
         e.order_id,
         o.order_number,
         e.event_type,
         e.event_version,
         e.status,
         e.attempt_count,
         e.is_demo,
         e.created_at,
         e.last_error,

         (
           e.status = 'sending'
           AND e.claimed_at < NOW() - INTERVAL '5 minutes'
         ) AS stalled

       FROM email_outbox e
       JOIN orders o ON o.id = e.order_id
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT 10`,
    ),
  ]);

  return {
    summary: summaryResult.rows[0],
    recent: recentResult.rows,
  };
}
// Entrega ao app as chaves PÚBLICAS (as secretas nunca saem do servidor).
// Os valores vêm das "Environment Variables" do projeto na Vercel.
export default function handler(req, res) {
  const env = process.env;
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    supabaseUrl: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '',
    supabaseKey: env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    vapidPublicKey: env.VAPID_PUBLIC_KEY || '',
  });
}

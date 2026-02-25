"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/agenda` },
    });

    setLoading(false);
    setMsg(error ? `Erro: ${error.message}` : "Enviei um link para seu e-mail. Abra e volte para o app.");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border p-6 space-y-4">
        <h1 className="text-xl font-semibold">Login</h1>

        <form className="space-y-3" onSubmit={onSubmit}>
          <label className="block text-sm font-medium">E-mail</label>
          <input
            className="w-full rounded-md border p-2"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <button className="w-full rounded-md bg-black text-white py-2 disabled:opacity-50" disabled={loading}>
            {loading ? "Enviando..." : "Enviar link"}
          </button>
        </form>

        {msg && <p className="text-sm text-gray-700">{msg}</p>}
      </div>
    </div>
  );
}
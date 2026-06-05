"use client";

import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (loading || !password) return;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        const next = new URLSearchParams(window.location.search).get("next") || "/";
        window.location.assign(next.startsWith("/") ? next : "/");
        return;
      }
      throw new Error("unauthorized");
    } catch {
      setError(true);
      setLoading(false);
      setPassword("");
    }
  };

  return (
    <div className="dm-login">
      <div className="aurora aurora-1" />
      <div className="aurora aurora-2" />
      <div className="aurora aurora-3" />
      <div className="grid-overlay" />

      <form className={`card${error ? " card-error" : ""}`} onSubmit={onSubmit}>
        <div className="logo">
          <span className="logo-mark">◆</span>
        </div>
        <h1 className="title">Deploy Console</h1>
        <p className="subtitle">部署管理控制台 · 安全登录</p>

        <label className="field">
          <span className="field-icon" aria-hidden>⬡</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="访问密码"
            autoFocus
            autoComplete="current-password"
            spellCheck={false}
          />
        </label>

        {error && <div className="err">密码错误，请重试</div>}

        <button type="submit" className="btn" disabled={loading}>
          <span className="btn-shine" />
          {loading ? <span className="spinner" /> : "进 入 控 制 台"}
        </button>

        <div className="foot">songuu.top · 受保护的生产环境</div>
      </form>

      <style jsx global>{`
        html,
        body {
          margin: 0;
          padding: 0;
          height: 100%;
          background: #05060f;
        }
      `}</style>

      <style jsx>{`
        .dm-login {
          position: fixed;
          inset: 0;
          display: grid;
          place-items: center;
          overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
            "Microsoft YaHei", sans-serif;
          background:
            radial-gradient(1200px 800px at 50% -10%, #131a3a 0%, #05060f 60%),
            #05060f;
        }
        .aurora {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.55;
          mix-blend-mode: screen;
          will-change: transform;
        }
        .aurora-1 {
          width: 560px;
          height: 560px;
          left: -120px;
          top: -140px;
          background: radial-gradient(circle, #6366f1, transparent 70%);
          animation: drift1 14s ease-in-out infinite;
        }
        .aurora-2 {
          width: 620px;
          height: 620px;
          right: -160px;
          top: 10%;
          background: radial-gradient(circle, #06b6d4, transparent 70%);
          animation: drift2 18s ease-in-out infinite;
        }
        .aurora-3 {
          width: 680px;
          height: 680px;
          left: 25%;
          bottom: -260px;
          background: radial-gradient(circle, #d946ef, transparent 70%);
          animation: drift3 20s ease-in-out infinite;
        }
        .grid-overlay {
          position: absolute;
          inset: 0;
          background-image: linear-gradient(rgba(255, 255, 255, 0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.04) 1px, transparent 1px);
          background-size: 46px 46px;
          mask-image: radial-gradient(circle at 50% 45%, #000 0%, transparent 75%);
        }

        .card {
          position: relative;
          z-index: 2;
          width: 360px;
          max-width: calc(100vw - 40px);
          padding: 40px 34px 28px;
          border-radius: 22px;
          background: rgba(20, 23, 40, 0.55);
          border: 1px solid rgba(255, 255, 255, 0.12);
          backdrop-filter: blur(22px) saturate(140%);
          box-shadow: 0 30px 80px -20px rgba(0, 0, 0, 0.7),
            inset 0 1px 0 rgba(255, 255, 255, 0.12);
          text-align: center;
          animation: rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .card-error {
          animation: shake 0.4s cubic-bezier(0.36, 0.07, 0.19, 0.97);
        }
        .logo {
          display: grid;
          place-items: center;
          width: 64px;
          height: 64px;
          margin: 0 auto 18px;
          border-radius: 18px;
          background: linear-gradient(135deg, #6366f1, #06b6d4);
          box-shadow: 0 10px 30px -6px rgba(99, 102, 241, 0.7);
          animation: float 4s ease-in-out infinite;
        }
        .logo-mark {
          font-size: 30px;
          color: #fff;
          filter: drop-shadow(0 0 8px rgba(255, 255, 255, 0.6));
        }
        .title {
          margin: 0;
          font-size: 26px;
          font-weight: 700;
          letter-spacing: 0.5px;
          background: linear-gradient(90deg, #c7d2fe, #67e8f9, #f0abfc, #c7d2fe);
          background-size: 300% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: sheen 6s linear infinite;
        }
        .subtitle {
          margin: 8px 0 28px;
          font-size: 13px;
          color: rgba(203, 213, 225, 0.7);
        }
        .field {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 14px;
          height: 50px;
          border-radius: 13px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.12);
          transition: border-color 0.25s, box-shadow 0.25s, background 0.25s;
        }
        .field:focus-within {
          border-color: rgba(103, 232, 249, 0.7);
          background: rgba(255, 255, 255, 0.09);
          box-shadow: 0 0 0 4px rgba(103, 232, 249, 0.14),
            0 0 26px -4px rgba(103, 232, 249, 0.5);
        }
        .field-icon {
          color: #67e8f9;
          font-size: 16px;
        }
        .field input {
          flex: 1;
          border: 0;
          outline: 0;
          background: transparent;
          color: #f1f5f9;
          font-size: 15px;
          letter-spacing: 2px;
        }
        .field input::placeholder {
          color: rgba(148, 163, 184, 0.6);
          letter-spacing: normal;
        }
        .err {
          margin: 12px 0 0;
          font-size: 12.5px;
          color: #fda4af;
          text-shadow: 0 0 12px rgba(244, 63, 94, 0.5);
        }
        .btn {
          position: relative;
          overflow: hidden;
          width: 100%;
          height: 50px;
          margin-top: 22px;
          border: 0;
          border-radius: 13px;
          cursor: pointer;
          color: #fff;
          font-size: 15px;
          font-weight: 600;
          letter-spacing: 1px;
          background: linear-gradient(135deg, #6366f1, #06b6d4);
          box-shadow: 0 12px 30px -8px rgba(99, 102, 241, 0.75);
          transition: transform 0.18s, box-shadow 0.18s, opacity 0.2s;
        }
        .btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 18px 40px -8px rgba(6, 182, 212, 0.8);
        }
        .btn:active:not(:disabled) {
          transform: translateY(0);
        }
        .btn:disabled {
          opacity: 0.75;
          cursor: progress;
        }
        .btn-shine {
          position: absolute;
          top: 0;
          left: -120%;
          width: 60%;
          height: 100%;
          background: linear-gradient(
            100deg,
            transparent,
            rgba(255, 255, 255, 0.45),
            transparent
          );
          animation: shine 3.2s ease-in-out infinite;
        }
        .spinner {
          display: inline-block;
          width: 18px;
          height: 18px;
          border: 2px solid rgba(255, 255, 255, 0.4);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }
        .foot {
          margin-top: 22px;
          font-size: 11px;
          letter-spacing: 0.4px;
          color: rgba(148, 163, 184, 0.5);
        }

        @keyframes rise {
          from {
            opacity: 0;
            transform: translateY(26px) scale(0.97);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes float {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-7px);
          }
        }
        @keyframes sheen {
          to {
            background-position: 300% 0;
          }
        }
        @keyframes shine {
          0% {
            left: -120%;
          }
          60%,
          100% {
            left: 160%;
          }
        }
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes shake {
          10%,
          90% {
            transform: translateX(-2px);
          }
          20%,
          80% {
            transform: translateX(4px);
          }
          30%,
          50%,
          70% {
            transform: translateX(-8px);
          }
          40%,
          60% {
            transform: translateX(8px);
          }
        }
        @keyframes drift1 {
          0%,
          100% {
            transform: translate(0, 0) scale(1);
          }
          50% {
            transform: translate(80px, 60px) scale(1.1);
          }
        }
        @keyframes drift2 {
          0%,
          100% {
            transform: translate(0, 0) scale(1);
          }
          50% {
            transform: translate(-70px, 50px) scale(1.15);
          }
        }
        @keyframes drift3 {
          0%,
          100% {
            transform: translate(0, 0) scale(1);
          }
          50% {
            transform: translate(60px, -50px) scale(1.08);
          }
        }
      `}</style>
    </div>
  );
}

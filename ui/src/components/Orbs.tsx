import { useState } from 'react';
import { Link } from 'react-router-dom';

interface OrbsProps {
  githubConnected: boolean;
  gmailConnected: boolean;
  liveToolkit: 'github' | 'gmail' | null;
  policyVersion?: string;
  currentUser: string;
  onToggleUser(): void;
}

const orbBase =
  'relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] transition-transform duration-200 ease-out hover:-translate-y-[3px] hover:scale-[1.06] cursor-pointer select-none';

function PulseRings() {
  return (
    <>
      <span className="pointer-events-none absolute inset-0 rounded-full border border-accent/60 animate-ring-expand" />
      <span
        className="pointer-events-none absolute inset-0 rounded-full border border-accent/60 animate-ring-expand"
        style={{ animationDelay: '0.55s' }}
      />
    </>
  );
}

/** The four circles from SPEC.md §6 — they carry demo weight, not decoration. */
export default function Orbs({
  githubConnected,
  gmailConnected,
  liveToolkit,
  policyVersion,
  currentUser,
  onToggleUser,
}: OrbsProps) {
  const [userSpun, setUserSpun] = useState(false);

  return (
    <div className="flex items-center gap-3">
      <div
        className={`${orbBase} ${githubConnected ? 'text-white' : 'text-white/35'}`}
        title={githubConnected ? 'GitHub connected' : 'GitHub not connected'}
      >
        {liveToolkit === 'github' && <PulseRings />}
        <GithubIcon />
      </div>

      <div
        className={`${orbBase} ${gmailConnected ? 'text-white' : 'text-white/35'}`}
        title={gmailConnected ? 'Gmail connected' : 'Gmail not connected'}
      >
        {liveToolkit === 'gmail' && <PulseRings />}
        <GmailIcon />
      </div>

      <Link to="/roster" className={`${orbBase} text-white/70`} title="Policy — open roster">
        <span className="text-lg leading-none">◆</span>
        {policyVersion && (
          <span className="absolute -bottom-1 -right-1 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-bold leading-none text-black">
            {policyVersion}
          </span>
        )}
      </Link>

      <button
        type="button"
        className={`${orbBase} text-white/70`}
        title={`Signed in as ${currentUser} — click to switch`}
        onClick={() => {
          setUserSpun((s) => !s);
          onToggleUser();
        }}
      >
        <span
          className="text-lg leading-none transition-transform duration-500 ease-out"
          style={{ transform: userSpun ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          ◑
        </span>
      </button>
    </div>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.09 3.29 9.4 7.86 10.93.58.1.79-.25.79-.56 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.38-5.25 5.67.42.36.78 1.07.78 2.16 0 1.56-.02 2.81-.02 3.19 0 .31.21.67.8.56A10.52 10.52 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
    </svg>
  );
}

function GmailIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.2" />
      <path d="M3.5 6l8.5 7 8.5-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

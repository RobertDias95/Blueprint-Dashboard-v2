import { OPENER_INSTALL_HREF, OPENER_UNINSTALL_HREF } from '../../lib/bridgeOpen';
import {
  IF_NOTHING_OPENS,
  INSTALL_STEPS,
  REMOVE_STEPS,
  WHAT_IT_DOES,
} from '../../lib/oneClickFolders';

// ===========================================================================
// ★★★ fix-654 (P-149) — Settings → My account → One-click folders
// ===========================================================================
//
// Bobby, 10-12: *"build it on my pc, and i go through the install option so
// that it is clear for everyone else."* So this page IS the instructions, and
// his own run-through is the test of them: numbered, plain words, and naming
// exactly what Chrome and Windows put on the screen and what to click.
//
// ★ The words themselves live in lib/oneClickFolders (data, so a test pins
//   them and the report can quote them verbatim).

const btn =
  'inline-block px-3 py-1.5 text-xs font-display font-semibold rounded border';

export default function OneClickFoldersPanel() {
  return (
    <div className="flex flex-col gap-3 text-xs" data-testid="one-click-folders">
      <p className="text-muted leading-relaxed" data-testid="one-click-what">
        {WHAT_IT_DOES}
      </p>

      <div className="flex flex-wrap gap-2">
        <a
          href={OPENER_INSTALL_HREF}
          download="Install-BridgeOpener.cmd"
          className={`${btn} bg-de text-white border-de hover:bg-de/90`}
          data-testid="one-click-download"
        >
          Download the installer
        </a>
        <a
          href={OPENER_UNINSTALL_HREF}
          download="Uninstall-BridgeOpener.cmd"
          className={`${btn} bg-bg text-text border-border hover:bg-s2`}
          data-testid="one-click-remove"
        >
          Download the remover
        </a>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wide text-dim font-display font-bold mb-1">
          Set it up (about a minute, once per computer)
        </div>
        <ol className="list-decimal pl-5 flex flex-col gap-1.5" data-testid="one-click-steps">
          {INSTALL_STEPS.map((s, i) => (
            <li key={i} className="leading-relaxed">
              <span className="text-text">{s.text}</span>
              {s.detail && <span className="block text-muted">{s.detail}</span>}
            </li>
          ))}
        </ol>
      </div>

      <p className="text-muted leading-relaxed" data-testid="one-click-fallback">
        {IF_NOTHING_OPENS}
      </p>
      <p className="text-muted leading-relaxed" data-testid="one-click-remove-steps">
        {REMOVE_STEPS}
      </p>
    </div>
  );
}

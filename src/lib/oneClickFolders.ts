// ===========================================================================
// ★★★ fix-654 (P-149) — the words on Settings → My account → One-click folders
// ===========================================================================
//
// Bobby, 10-12: *"build it on my pc, and i go through the install option so
// that it is clear for everyone else."* These ARE the instructions, and his
// own run-through is the test of them: numbered, plain words, naming exactly
// what Chrome and Windows put on the screen and what to click. Data rather
// than JSX so a test pins them and the report can quote them verbatim.

export interface SetupStep {
  /** What to do, in plain words. */
  text: string;
  /** What the screen shows and what to click, when there is something. */
  detail?: string;
}

export const INSTALL_STEPS: readonly SetupStep[] = [
  {
    text: 'Click “Download the installer” below.',
    detail:
      'Chrome may warn that this kind of file can harm your computer. Click Keep. (If you only see Discard, click the arrow or ⋮ next to the file in Chrome’s download list, then Keep.)',
  },
  {
    text: 'Open your Downloads folder and double-click Install-BridgeOpener.cmd.',
  },
  {
    text: 'If a blue box says “Windows protected your PC”, click More info, then Run anyway.',
    detail:
      'It is ours. It only adds a setting to your own Windows account and does not need admin rights.',
  },
  {
    text: 'A black window opens and says “Bridge opener is installed.” Press any key to close it.',
  },
  {
    text: 'Back in the Bridge, open any project and click “Project folder ↗” under Site Data.',
  },
  {
    text: 'Chrome asks “Open Bridge opener?” (it may say “Open Windows PowerShell?” instead).',
    detail:
      'Tick “Always allow … to open links of this type”, then click Open. Chrome only asks this once.',
  },
  {
    text: 'The project’s folder opens in File Explorer. From now on it is one click.',
  },
];

export const IF_NOTHING_OPENS =
  'If nothing opens: the folder’s path is already copied. Click in the address bar at the top of File Explorer, press Ctrl+V, then Enter.';

export const REMOVE_STEPS =
  'To remove it: click “Download the remover”, then double-click Uninstall-BridgeOpener.cmd in your Downloads folder (the same Keep / More info / Run anyway steps as above). “Project folder ↗” then goes back to only copying the path.';

export const WHAT_IT_DOES =
  'The Bridge runs in your browser, and Windows does not let a browser open folders on the server (\\\\bpc-file) by itself. The Bridge opener is a small add-on for your Windows account that lets “Project folder ↗” and “Open original” open the folder or file directly. It only opens folders and documents on \\\\bpc-file\\SoleilData — it never runs programs and never downloads anything. Without it, those links still copy the path for you to paste.';

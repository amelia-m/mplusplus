/**
 * Example diagrams offered on the start screen, so a visitor without Mplus
 * can try the app. Only synthetic fixtures (CC0, `dgm/README.md`) are
 * bundled: invented models fitted by Mplus to simulated data. Each demo is
 * opened through the same path as a dropped file, `.dgm` first and then
 * its `.out`, and each file can also be downloaded to try a drop.
 */
import synSemDgm from '../../../dgm/syn_sem.dgm?raw';
import synSemOut from '../../test/fixtures/sample.out?raw';
import synPathDgm from '../../../dgm/syn_path.dgm?raw';
import synTwoFactorDgm from '../../../dgm/syn_twofactor.dgm?raw';
import synTwoFactorOut from '../../test/fixtures/syn_twofactor.out?raw';

export interface DemoFile {
  name: string;
  text: string;
}

export interface Demo {
  label: string;
  /** Opened in order: the `.dgm`, then any `.out` from the same run. */
  files: DemoFile[];
}

export const DEMOS: Demo[] = [
  {
    label: 'SEM with p-values',
    files: [
      { name: 'syn_sem.dgm', text: synSemDgm },
      { name: 'syn_sem.out', text: synSemOut },
    ],
  },
  {
    label: 'Two-factor model with p-values',
    files: [
      { name: 'syn_twofactor.dgm', text: synTwoFactorDgm },
      { name: 'syn_twofactor.out', text: synTwoFactorOut },
    ],
  },
  {
    label: 'Path model',
    files: [{ name: 'syn_path.dgm', text: synPathDgm }],
  },
];

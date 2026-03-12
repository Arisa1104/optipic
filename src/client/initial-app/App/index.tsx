import type { FileDropEvent } from 'file-drop-element';
import type SnackBarElement from 'shared/custom-els/snack-bar';
import type { SnackOptions } from 'shared/custom-els/snack-bar';

import { h, Component } from 'preact';

import { linkRef } from 'shared/prerendered-app/util';
import * as style from './style.css';
import 'add-css:./style.css';
import 'file-drop-element';
import 'shared/custom-els/snack-bar';
import Intro from 'shared/prerendered-app/Intro';
import 'shared/custom-els/loading-spinner';
import { DownloadIcon, AddIcon } from 'client/lazy-app/icons';

const ROUTE_EDITOR = '/editor';

const compressPromise = import('client/lazy-app/Compress');
const swBridgePromise = import('client/lazy-app/sw-bridge');

const textEncoder = new TextEncoder();

function crc32(data: Uint8Array): number {
  let crc = -1;
  for (let i = 0; i < data.length; i += 1) {
    crc ^= data[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

async function createZip(files: File[]): Promise<Blob> {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const nameBytes = textEncoder.encode(file.name);
    const crc = crc32(fileBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, fileBytes.length, true);
    localView.setUint32(22, fileBytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, fileBytes.length, true);
    centralView.setUint32(24, fileBytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    localParts.push(localHeader, fileBytes);
    centralParts.push(centralHeader);

    offset += localHeader.length + fileBytes.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, endRecord], {
    type: 'application/zip',
  });
}

function back() {
  window.history.back();
}

interface Props {}

interface State {
  awaitingShareTarget: boolean;
  files: File[];
  activeFileIndex: number;
  isEditorOpen: boolean;
  compressedFiles: Record<string, File>;
  Compress?: typeof import('client/lazy-app/Compress').default;
}

export default class App extends Component<Props, State> {
  state: State = {
    awaitingShareTarget: new URL(location.href).searchParams.has(
      'share-target',
    ),
    isEditorOpen: false,
    files: [],
    activeFileIndex: 0,
    compressedFiles: {},
    Compress: undefined,
  };

  snackbar?: SnackBarElement;
  private compressedWaiters: Record<string, Array<() => void>> = {};

  constructor() {
    super();

    compressPromise
      .then((module) => {
        this.setState({ Compress: module.default });
      })
      .catch(() => {
        this.showSnack('Failed to load app');
      });

    swBridgePromise.then(async ({ offliner, getSharedImage }) => {
      offliner(this.showSnack);
      if (!this.state.awaitingShareTarget) return;
      const file = await getSharedImage();
      // Remove the ?share-target from the URL
      history.replaceState('', '', '/');
      this.openEditor();
      this.setState({
        files: [file],
        activeFileIndex: 0,
        awaitingShareTarget: false,
      });
    });

    document.body.addEventListener('gesturestart', (event: any) => {
      event.preventDefault();
    });

    window.addEventListener('popstate', this.onPopState);
  }

  private onFileDrop = ({ files }: FileDropEvent) => {
    if (!files || files.length === 0) return;
    const nextFiles = Array.from(files);
    this.openEditor();
    // Append or replace? Let's append if already editing, or replace if in Intro
    this.setState((prev) => {
      if (!prev.isEditorOpen) {
        return { files: nextFiles, activeFileIndex: 0 };
      }
      return {
        files: [...prev.files, ...nextFiles],
      };
    });
  };

  private onIntroPickFile = (files: File[]) => {
    this.openEditor();
    this.setState({ files, activeFileIndex: 0 });
  };

  private showSnack = (
    message: string,
    options: SnackOptions = {},
  ): Promise<string> => {
    if (!this.snackbar) throw Error('Snackbar missing');
    return this.snackbar.showSnackbar(message, options);
  };

  private onPopState = () => {
    this.setState({ isEditorOpen: location.pathname === ROUTE_EDITOR });
  };

  private openEditor = () => {
    if (this.state.isEditorOpen) return;
    const editorURL = new URL(location.href);
    editorURL.pathname = ROUTE_EDITOR;
    history.pushState(null, '', editorURL.href);
    this.setState({ isEditorOpen: true });
  };

  private selectFile = (index: number) => {
    this.setState({ activeFileIndex: index });
  };

  private getFileKey = (file: File) =>
    `${file.name}:${file.size}:${file.lastModified}`;

  private onCompressedFile = (sourceFile: File, compressedFile: File) => {
    const key = this.getFileKey(sourceFile);
    this.setState(
      (prev) => ({
        compressedFiles: {
          ...prev.compressedFiles,
          [key]: compressedFile,
        },
      }),
      () => {
        const waiters = this.compressedWaiters[key];
        if (!waiters || waiters.length === 0) return;
        delete this.compressedWaiters[key];
        waiters.forEach((resolve) => resolve());
      },
    );
  };

  private waitForCompressedFile = (sourceFile: File): Promise<void> => {
    const key = this.getFileKey(sourceFile);
    if (this.state.compressedFiles[key]) return Promise.resolve();

    return new Promise<void>((resolve) => {
      const waiters = this.compressedWaiters[key] || [];
      waiters.push(resolve);
      this.compressedWaiters[key] = waiters;
    });
  };

  private downloadAllCompressed = async () => {
    if (this.state.files.length === 0) return;

    const previousActiveIndex = this.state.activeFileIndex;

    for (const [index, sourceFile] of this.state.files.entries()) {
      const key = this.getFileKey(sourceFile);
      if (this.state.compressedFiles[key]) continue;

      await new Promise<void>((resolve) => {
        this.setState({ activeFileIndex: index }, resolve);
      });

      await this.waitForCompressedFile(sourceFile);
    }

    await new Promise<void>((resolve) => {
      this.setState({ activeFileIndex: previousActiveIndex }, resolve);
    });

    const downloads = this.state.files
      .map((file) => this.state.compressedFiles[this.getFileKey(file)])
      .filter((file): file is File => Boolean(file));

    if (downloads.length === 0) {
      this.showSnack('No compressed files are ready yet.', {
        timeout: 3000,
        actions: [],
      });
      return;
    }

    const zipBlob = await createZip(downloads);
    const zipUrl = URL.createObjectURL(zipBlob);
    const link = document.createElement('a');
    link.href = zipUrl;
    link.download = `optipic-compressed-${Date.now()}.zip`;
    link.click();
    URL.revokeObjectURL(zipUrl);
  };

  private removeFile = (index: number, e: Event) => {
    e.stopPropagation();
    this.setState((prev) => {
      const newFiles = [...prev.files];
      newFiles.splice(index, 1);

      if (newFiles.length === 0) {
        history.pushState(null, '', '/');
        return { files: [], isEditorOpen: false, activeFileIndex: 0 };
      }

      let newIndex = prev.activeFileIndex;
      if (index < newIndex || newIndex >= newFiles.length) {
        newIndex = Math.max(0, newIndex - 1);
      }

      return { files: newFiles, activeFileIndex: newIndex };
    });
  };

  render(
    {}: Props,
    {
      files,
      activeFileIndex,
      isEditorOpen,
      Compress,
      awaitingShareTarget,
    }: State,
  ) {
    const showSpinner = awaitingShareTarget || (isEditorOpen && !Compress);
    const activeFile = files[activeFileIndex];

    return (
      <div class={style.app}>
        <div class={style.appContainer}>
          {isEditorOpen && files.length > 0 && (
            <div class={style.fileSidebar}>
              <div class={style.sidebarHeader}>
                <h3>Files ({files.length})</h3>
                <div class={style.sidebarActions}>
                  <button
                    class={style.downloadAllBtn}
                    onClick={this.downloadAllCompressed}
                    title="Download all compressed"
                    aria-label="Download all compressed"
                  >
                    <DownloadIcon />
                    <span class={style.btnLabel}>ZIP</span>
                  </button>
                  <button
                    class={style.addMoreBtn}
                    title="Add files"
                    aria-label="Add files"
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.multiple = true;
                      input.onchange = (e) => {
                        const target = e.target as HTMLInputElement;
                        if (target.files?.length) {
                          this.onFileDrop({
                            files: Array.from(target.files),
                          } as any);
                        }
                      };
                      input.click();
                    }}
                  >
                    <AddIcon />
                  </button>
                </div>
              </div>
              <ul class={style.fileList}>
                {files.map((f, i) => (
                  <li
                    class={`${style.fileItem} ${
                      i === activeFileIndex ? style.activeFile : ''
                    }`}
                    onClick={() => this.selectFile(i)}
                  >
                    <div class={style.fileItemName} title={f.name}>
                      {f.name}
                    </div>
                    <button
                      class={style.fileItemRemove}
                      onClick={(e) => this.removeFile(i, e)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <file-drop multiple onfiledrop={this.onFileDrop} class={style.drop}>
            {showSpinner ? (
              <loading-spinner class={style.appLoader} />
            ) : isEditorOpen ? (
              Compress &&
              activeFile && (
                <Compress
                  key={
                    activeFile.name + activeFile.lastModified + activeFileIndex
                  }
                  file={activeFile}
                  showSnack={this.showSnack}
                  onBack={back}
                  onCompressedFile={this.onCompressedFile}
                />
              )
            ) : (
              <Intro onFile={this.onIntroPickFile} showSnack={this.showSnack} />
            )}
            <snack-bar ref={linkRef(this, 'snackbar')} />
          </file-drop>
        </div>
      </div>
    );
  }
}

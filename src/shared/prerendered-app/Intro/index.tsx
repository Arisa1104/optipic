import { h, Component } from 'preact';

import { linkRef } from 'shared/prerendered-app/util';
import '../../custom-els/loading-spinner';
import logo from 'url:./imgs/logo.svg';
import githubLogo from 'url:./imgs/github-logo.svg';
import bgImage from 'url:./imgs/bg.jpg';
import * as style from './style.css';
import type SnackBarElement from 'shared/custom-els/snack-bar';
import 'shared/custom-els/snack-bar';

const installButtonSource = 'introInstallButton-Purple';
const supportsClipboardAPI =
  !__PRERENDER__ && navigator.clipboard && navigator.clipboard.read;

async function getImageClipboardItem(
  items: ClipboardItem[],
): Promise<undefined | Blob> {
  for (const item of items) {
    const type = item.types.find((type) => type.startsWith('image/'));
    if (type) return item.getType(type);
  }
}

interface Props {
  onFile?: (files: File[]) => void;
  showSnack?: SnackBarElement['showSnackbar'];
}
interface State {
  beforeInstallEvent?: BeforeInstallPromptEvent;
}

export default class Intro extends Component<Props, State> {
  state: State = {};
  private fileInput?: HTMLInputElement;
  private installingViaButton = false;

  componentDidMount() {
    // Listen for beforeinstallprompt events, indicating Squoosh is installable.
    window.addEventListener(
      'beforeinstallprompt',
      this.onBeforeInstallPromptEvent,
    );

    // Listen for the appinstalled event, indicating Squoosh has been installed.
    window.addEventListener('appinstalled', this.onAppInstalled);
  }

  componentWillUnmount() {
    window.removeEventListener(
      'beforeinstallprompt',
      this.onBeforeInstallPromptEvent,
    );
    window.removeEventListener('appinstalled', this.onAppInstalled);
  }

  private onFileChange = (event: Event): void => {
    const fileInput = event.target as HTMLInputElement;
    if (!fileInput.files || fileInput.files.length === 0) return;
    const files = Array.from(fileInput.files);
    this.fileInput!.value = '';
    this.props.onFile!(files);
  };

  private onOpenClick = () => {
    this.fileInput!.click();
  };

  private onBeforeInstallPromptEvent = (event: BeforeInstallPromptEvent) => {
    // Don't show the mini-infobar on mobile
    event.preventDefault();

    // Save the beforeinstallprompt event so it can be called later.
    this.setState({ beforeInstallEvent: event });

    // Log the event.
    const gaEventInfo = {
      eventCategory: 'pwa-install',
      eventAction: 'promo-shown',
      nonInteraction: true,
    };
    ga('send', 'event', gaEventInfo);
  };

  private onInstallClick = async (event: Event) => {
    event.preventDefault();
    event.stopPropagation();

    // Get the deferred beforeinstallprompt event
    const beforeInstallEvent = this.state.beforeInstallEvent;
    // If there's no deferred prompt, bail.
    if (!beforeInstallEvent) return;

    this.installingViaButton = true;

    try {
      // Show the browser install prompt
      await beforeInstallEvent.prompt();

      // Wait for the user to accept or dismiss the install prompt
      const { outcome } = await beforeInstallEvent.userChoice;
      // Send the analytics data
      const gaEventInfo = {
        eventCategory: 'pwa-install',
        eventAction: 'promo-clicked',
        eventLabel: installButtonSource,
        eventValue: outcome === 'accepted' ? 1 : 0,
      };
      ga('send', 'event', gaEventInfo);

      // If the prompt was dismissed, we aren't going to install via the button.
      if (outcome === 'dismissed') {
        this.installingViaButton = false;
        this.setState({ beforeInstallEvent: undefined });
      }
    } catch (err: any) {
      console.error('Prompt failed:', err);
      if (this.props.showSnack) {
        this.props.showSnack('Install prompt failed: ' + err.message);
      }
      this.setState({ beforeInstallEvent: undefined });
    }
  };

  private onAppInstalled = () => {
    // We don't need the install button, if it's shown
    this.setState({ beforeInstallEvent: undefined });

    // Don't log analytics if page is not visible
    if (document.hidden) return;

    // Try to get the install, if it's not set, use 'browser'
    const source = this.installingViaButton ? installButtonSource : 'browser';
    ga('send', 'event', 'pwa-install', 'installed', source);

    // Clear the install method property
    this.installingViaButton = false;
  };

  private onPasteClick = async () => {
    let clipboardItems: ClipboardItem[];

    try {
      clipboardItems = await navigator.clipboard.read();
    } catch (err) {
      this.props.showSnack!(`No permission to access clipboard`);
      return;
    }

    const blob = await getImageClipboardItem(clipboardItems);

    if (!blob) {
      this.props.showSnack!(`No image found in the clipboard`);
      return;
    }

    this.props.onFile!([new File([blob], 'image.png')]);
  };

  render({}: Props, { beforeInstallEvent }: State) {
    return (
      <div
        class={style.intro}
        style={{ background: `url(${bgImage}) no-repeat center/cover` }}
      >
        <input
          class={style.hide}
          ref={linkRef(this, 'fileInput')}
          type="file"
          multiple
          onChange={this.onFileChange}
        />
        <div class={style.main}>
          <div class={style.hero}>
            <h1 class={style.title}>OptiPic</h1>
            <p class={style.subtitle}>Premium Image Optimization</p>
          </div>
          <div class={style.loadImg}>
            <div
              class={style.loadImgContent}
              style={{ visibility: __PRERENDER__ ? 'hidden' : '' }}
            >
              <button class={style.loadBtn} onClick={this.onOpenClick}>
                <svg viewBox="0 0 24 24" class={style.loadIcon}>
                  <path d="M19 7v3h-2V7h-3V5h3V2h2v3h3v2h-3zm-3 4V8h-3V5H5a2 2 0 00-2 2v12c0 1.1.9 2 2 2h12a2 2 0 002-2v-8h-3zM5 19l3-4 2 3 3-4 4 5H5z" />
                </svg>
                <span>Select Files</span>
              </button>
              <div class={style.dropZoneText}>
                <span>Drag and drop anywhere, OR </span>
                {supportsClipboardAPI ? (
                  <button class={style.pasteBtn} onClick={this.onPasteClick}>
                    Paste from clipboard
                  </button>
                ) : (
                  'Paste from clipboard'
                )}
              </div>
            </div>
          </div>
        </div>
        <footer class={style.footer}>
          <div class={style.footerContainer}>
            <div class={style.footerPadding}>
              <footer class={style.footerItems}>
                <a
                  class={style.footerLink}
                  href="https://github.com/GoogleChromeLabs/squoosh/blob/dev/README.md#privacy"
                >
                  Privacy
                </a>
                <a
                  class={style.footerLinkWithLogo}
                  href="https://github.com/GoogleChromeLabs/squoosh"
                >
                  <img src={githubLogo} alt="" width="10" height="10" />
                  Source on Github
                </a>
              </footer>
            </div>
          </div>
        </footer>
        {beforeInstallEvent && (
          <button class={style.installBtn} onClick={this.onInstallClick}>
            Install App
          </button>
        )}
      </div>
    );
  }
}

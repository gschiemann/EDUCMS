"use client";

/**
 * Customer-facing "Getting Started" guide.
 *
 * Designed to be both **read on screen** and **printed to PDF** with
 * proper typographic chapters, real screenshots/embeds, and clean
 * page breaks. The "Print PDF" button in the header opens the
 * browser's print dialog with print-only CSS that swaps the on-screen
 * navigation chrome for a paginated layout — same approach Linear,
 * Notion, and Stripe use for their public manuals (Headless Chrome
 * rendering on the server is a fine v2 if Sales wants to email a
 * one-click PDF, but browser print is what produces the bytes today).
 *
 * Structure:
 *   Cover  →  Welcome  →  TOC  →  5 chapters  →  Support
 *
 * Live template embeds (Rainbow, Arcade, Varsity) appear in the
 * Templates chapter exactly like they appear on the marketing
 * landing page, so the buyer knows the screenshots aren't doctored —
 * those scenes are literally rendering in real time inside the iframe.
 *
 * To regenerate the PDF: open /guide/getting-started, click Print PDF
 * (or Cmd/Ctrl+P), choose "Save as PDF", set margins to "Default" and
 * scale to "Default."
 */

import { useEffect, useRef } from 'react';
import {
  MonitorPlay,
  Upload,
  Layers,
  CalendarDays,
  Shield,
  Printer,
  CheckCircle2,
  ArrowRight,
  Tv,
  Sparkles,
} from 'lucide-react';

export default function GettingStartedGuide() {
  return (
    <div className="guide-root">
      <PrintControls />
      <CoverPage />
      <Welcome />
      <TableOfContents />
      <Chapter1Pair />
      <Chapter2Upload />
      <Chapter3Playlists />
      <Chapter4Templates />
      <Chapter5Emergency />
      <SupportPage />
      <GuideStyles />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Print controls — sticky bar at the top with "Print PDF" + version.
   The bar is hidden in the print stylesheet so it doesn't show up
   on the saved PDF.
   ────────────────────────────────────────────────────────────────── */
function PrintControls() {
  return (
    <div className="guide-controls">
      <div className="guide-controls-inner">
        <div className="guide-controls-meta">
          <span className="guide-controls-eyebrow">EduSignage</span>
          <span className="guide-controls-title">Getting Started Guide</span>
        </div>
        <button
          type="button"
          onClick={() => typeof window !== 'undefined' && window.print()}
          className="guide-controls-print"
        >
          <Printer className="w-4 h-4" />
          Print PDF
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Cover page — full bleed, centered branded headline + subtitle.
   Page-break-after:always pushes the welcome page to its own sheet
   when printed.
   ────────────────────────────────────────────────────────────────── */
function CoverPage() {
  return (
    <section className="guide-cover">
      <div className="guide-cover-bg" aria-hidden />
      <div className="guide-cover-stage">
        <div className="guide-cover-mark">
          <MonitorPlay strokeWidth={1.5} />
        </div>
        <p className="guide-cover-eyebrow">EduSignage Quick-Start</p>
        <h1 className="guide-cover-title">
          Light up your screens
          <br />
          <span className="guide-cover-grad">in 30 minutes.</span>
        </h1>
        <p className="guide-cover-lead">
          A printable walkthrough for new K-12 districts. Everything you need
          to go from a fresh login to a hallway display rotating real content.
        </p>
        <div className="guide-cover-footer">
          <span>Version 1.0</span>
          <span>·</span>
          <span suppressHydrationWarning>{new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Welcome — sets expectation, "what you'll need" checklist, "what
   you'll have" deliverable. Single-page spread.
   ────────────────────────────────────────────────────────────────── */
function Welcome() {
  return (
    <section className="guide-page">
      <PageHeader chapter="Welcome" title="Before you start" />
      <p className="guide-lede">
        This guide takes you through the four moves every new EduSignage
        customer makes on day one: <strong>connect a screen</strong>,
        <strong> upload your content</strong>, <strong>pick a template</strong>,
        and <strong>publish a playlist</strong>. By the last page you&rsquo;ll
        have content rotating on a real screen.
      </p>

      <div className="guide-callout-grid">
        <div className="guide-callout">
          <h3>What you&rsquo;ll need</h3>
          <ul>
            <li>A laptop and a stable internet connection</li>
            <li>One screen with a browser (any Smart TV, Chromebook, or kiosk)</li>
            <li>Your district&rsquo;s admin login from the welcome email</li>
            <li>A few images, videos, or PDFs to show on the screen</li>
          </ul>
        </div>
        <div className="guide-callout guide-callout-accent">
          <h3>What you&rsquo;ll have at the end</h3>
          <ul>
            <li>A paired display showing live content</li>
            <li>A reusable playlist your team can edit anytime</li>
            <li>A working schedule so the right content plays at the right time</li>
            <li>A clear path to set up emergency alerts (Chapter&nbsp;5)</li>
          </ul>
        </div>
      </div>

      <div className="guide-toc-tip">
        <Sparkles className="w-4 h-4" />
        <span>
          Each chapter is one printed page. Skip ahead any time — every
          chapter stands on its own.
        </span>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Table of contents — clean numbered list with chapter blurbs.
   ────────────────────────────────────────────────────────────────── */
function TableOfContents() {
  const items = [
    { n: 1, title: 'Connect your first screen', blurb: 'Pair a TV, Chromebook, or kiosk in under five minutes.', icon: Tv },
    { n: 2, title: 'Upload your content', blurb: 'Drop images, videos, PDFs, or web links into your library.', icon: Upload },
    { n: 3, title: 'Build & publish a playlist', blurb: 'Choose what plays, when, and on which screen.', icon: CalendarDays },
    { n: 4, title: 'Or skip the slideshow — pick a template', blurb: '60+ ready-to-go full-screen layouts. Same Publish flow, different content.', icon: Layers },
    { n: 5, title: 'Emergency alerts', blurb: 'Lockdown, weather, evacuation — wired to every screen.', icon: Shield },
  ];
  return (
    <section className="guide-page">
      <PageHeader chapter="Contents" title="What&rsquo;s in this guide" />
      <ol className="guide-toc-list">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <li key={it.n}>
              <span className="guide-toc-num">{String(it.n).padStart(2, '0')}</span>
              <span className="guide-toc-icon"><Icon className="w-5 h-5" strokeWidth={2} /></span>
              <span className="guide-toc-body">
                <span className="guide-toc-title">{it.title}</span>
                <span className="guide-toc-blurb">{it.blurb}</span>
              </span>
              <span className="guide-toc-page">p.&nbsp;{it.n + 3}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Chapter 1 — Pair a screen.
   ────────────────────────────────────────────────────────────────── */
function Chapter1Pair() {
  return (
    <section className="guide-page">
      <PageHeader chapter="Chapter 1" title="Connect your first screen" />
      <p className="guide-lede">
        Any web browser becomes an EduSignage display. You don&rsquo;t need
        special hardware — Smart TVs, Chromebooks on a wheeled cart, and
        existing wall-mounted kiosks all work the same way.
      </p>

      <div className="guide-steps">
        <Step n={1} title="Open the player URL on the screen">
          On your TV or Chromebook, open <code>edusignage.app/player</code>.
          You&rsquo;ll see a 6-character pairing code on a branded splash
          screen.
        </Step>
        <Step n={2} title="Open Screens in your dashboard">
          On your laptop, log in to the EduSignage dashboard and click
          <strong> Screens</strong> in the left sidebar. Click
          <strong> Pair Screen</strong>.
        </Step>
        <Step n={3} title="Enter the code">
          Type the 6-character code from the screen, give the screen a
          friendly name (&ldquo;Lobby A&rdquo;, &ldquo;Cafeteria&rdquo;,
          &ldquo;Hallway 2&rdquo;), and click <strong>Pair</strong>.
        </Step>
        <Step n={4} title="That&rsquo;s it">
          The display flips from the pairing code to a Connected splash.
          You&rsquo;ll see the screen on your dashboard list with a green
          ONLINE chip.
        </Step>
      </div>

      <Tip>
        <strong>Want to use the Android player APK instead?</strong> Sideload
        the APK from <code>edusignage.app/api/v1/player/apk/latest</code>,
        open it once, and it will pair the same way — except every future
        update lands automatically with no reinstall. See the APK install
        notes on your dashboard&rsquo;s Settings → Devices page.
      </Tip>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Chapter 2 — Upload content.
   ────────────────────────────────────────────────────────────────── */
function Chapter2Upload() {
  return (
    <section className="guide-page">
      <PageHeader chapter="Chapter 2" title="Upload your content" />
      <p className="guide-lede">
        The Assets library is the bucket every screen pulls from. Anything
        you put here can be added to a playlist — images for posters and
        announcements, videos for morning news, PDFs for menus, even live
        web URLs.
      </p>

      <div className="guide-steps">
        <Step n={1} title="Open Assets">
          From the dashboard sidebar, click <strong>Assets</strong>. You&rsquo;ll
          see your media library, organized into folders.
        </Step>
        <Step n={2} title="Click Upload">
          The Upload button opens a folder picker. Pick the folder you want
          (or stay on All Files). You can also create a new folder right
          there with the <strong>+ New folder</strong> button.
        </Step>
        <Step n={3} title="Drop your files in">
          Drag and drop any combination of images, videos, PDFs from your
          desktop. Each file shows a progress bar; once they hit 100% they
          appear as tiles in the library. To add a web URL instead, click
          <strong> Add URL</strong> and paste — we&rsquo;ll fetch a screenshot
          for the preview.
        </Step>
        <Step n={4} title="What gets supported">
          JPEG, PNG, WebP, GIF, MP4, WebM, MOV, MP3, PDF, and any HTTPS URL.
          Up to 200 MB per file by default; ask support if you need bigger.
        </Step>
      </div>

      <Tip>
        Need approvals? CONTRIBUTOR-role uploads land in a review queue
        first; admins approve from the bell-icon notifications. Anything
        admins upload publishes straight to the library.
      </Tip>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Chapter 3 — Playlists (the primary publish path).
   ────────────────────────────────────────────────────────────────── */
function Chapter3Playlists() {
  return (
    <section className="guide-page">
      <PageHeader chapter="Chapter 3" title="Build & publish a playlist" />
      <p className="guide-lede">
        A playlist is the sequence of slides a screen plays. You can mix
        images, videos, and templates in any order, set how long each one
        shows, and decide which screens (and times) it runs on.
      </p>

      <div className="guide-steps">
        <Step n={1} title="Create the playlist">
          Click <strong>Playlists</strong> in the sidebar, then
          <strong> + New Playlist</strong>. Choose <em>Media Playlist</em>
          for a slideshow of assets, or <em>From Template</em> to start with
          a layout from Chapter 3.
        </Step>
        <Step n={2} title="Add content">
          Click <strong>Add Media</strong>. The picker opens your asset
          library — multi-select what you want and click <strong>Add to
          Playlist</strong>. Each slide&rsquo;s duration is editable inline.
        </Step>
        <Step n={3} title="Drag to reorder">
          Grab any slide row and drag to reorder. The order on screen
          matches what you see in the editor, top to bottom.
        </Step>
        <Step n={4} title="Schedule & publish">
          Click <strong>Schedule to Screen</strong>. Pick the screen (or
          group), the days of week, and a time window if you want it to
          play only during certain hours. Two buttons at the bottom:
          <strong> Save</strong> stages the schedule as a draft;
          <strong> Publish</strong> sends it live immediately.
        </Step>
      </div>

      <Tip>
        Use the <strong>on/off toggle</strong> on the playlist card to
        flip a saved schedule live without re-opening it. Pre-build your
        Friday pep-rally rotation on Monday, leave it as a draft, then
        flip it on Friday morning with one click.
      </Tip>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Chapter 4 — Templates as the "second publish option".
   Not a detour from the playlist flow above — a sibling publish
   path. Same Schedule / Publish buttons from Chapter 3, just with
   a full-screen layout instead of a discrete slideshow.
   ────────────────────────────────────────────────────────────────── */
function Chapter4Templates() {
  return (
    <section className="guide-page">
      <PageHeader chapter="Chapter 4" title="Or skip the slideshow — use a template" />
      <p className="guide-lede">
        A playlist of slides is one way to light up a screen. A
        <strong> template</strong> is the other. Templates are full-screen
        layouts we&rsquo;ve already designed — a scoreboard lobby, a
        cafeteria menu board, a hallway schedule — that you fill in with a
        title, a subtitle, and a few photos.
      </p>

      <p className="guide-body">
        Below are three working templates as they actually render on a
        screen. Each covers the whole display; no slideshow, no
        per-slide durations. Pick the look, change the words, publish.
      </p>

      <div className="guide-template-row">
        <TemplateTile
          src="/demo/templates/rainbow.html"
          name="Rainbow"
          tag="Elementary"
          tagCls="es"
          desc="Friendly, playful — perfect for K-5 lobbies."
        />
        <TemplateTile
          src="/demo/templates/middle-school.html"
          name="Pep Rally"
          tag="Middle"
          tagCls="ms"
          desc="Stadium spotlights + scoreboard clock for middle-school lobbies."
        />
        <TemplateTile
          src="/demo/templates/varsity.html"
          name="Varsity"
          tag="High"
          tagCls="hs"
          desc="Athletic scoreboard energy for HS lobbies."
        />
      </div>

      <div className="guide-steps">
        <Step n={1} title="New Playlist → From Template">
          Click <strong>+ New Playlist</strong> on the Playlists page and
          choose <em>From Template</em> instead of <em>Media Playlist</em>.
        </Step>
        <Step n={2} title="Pick the look">
          Browse the gallery, filter by grade level (Elementary / Middle /
          High / All ages) and category (Lobby, Cafeteria, Hallway,
          etc.). Click a template to choose it.
        </Step>
        <Step n={3} title="Fill in the content">
          The template editor shows every field you can change —
          headline, subtitle, announcement, teacher-of-the-week, ticker
          messages, weather location. Save as you go.
        </Step>
        <Step n={4} title="Publish — same flow as Chapter 3">
          Click <strong>Schedule to Screen</strong>, pick the target
          screen and days/times, and hit Publish. The template takes over
          the full screen instead of cycling slides.
        </Step>
      </div>

      <Tip>
        Templates and slideshows aren&rsquo;t mutually exclusive —
        schedule a template to the lobby on weekdays, a slideshow of
        event photos on weekends. Each screen holds as many schedules as
        you want, with priorities to resolve overlap.
      </Tip>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Chapter 5 — Emergency.
   ────────────────────────────────────────────────────────────────── */
function Chapter5Emergency() {
  return (
    <section className="guide-page">
      <PageHeader chapter="Chapter 5" title="Emergency alerts" />
      <p className="guide-lede">
        EduSignage can flash a lockdown, weather, or evacuation message
        across every screen in the district within seconds. The same
        infrastructure that pushes daily content carries the alerts —
        no extra hardware, no separate app to install.
      </p>

      <div className="guide-steps">
        <Step n={1} title="Set your emergency content">
          From the dashboard, open <strong>Settings → Panic Button
          Integrations</strong>. For each alert type (Lockdown, Evacuate,
          Weather, All Clear) upload an image or video and short text.
        </Step>
        <Step n={2} title="Pick who can trigger">
          Under <strong>Settings → Users</strong>, flip the
          &ldquo;Can trigger panic&rdquo; capability on for the staff who
          should have access. By default, only admins do.
        </Step>
        <Step n={3} title="Test the drill flow">
          Open the panic page on your phone (URL on Settings → Panic),
          choose <em>Drill</em>, and hold the button for 3 seconds. Every
          paired screen should flip to the message within 5 seconds. The
          dashboard logs the trigger immutably.
        </Step>
        <Step n={4} title="Verify your safety net">
          On the Screens page, every kiosk shows a green
          &ldquo;Emergency cache READY&rdquo; chip when its panic content
          is downloaded to disk. No green chip = the screen will fetch
          from the network during an alert (still works, but slower).
        </Step>
      </div>

      <p className="guide-disclaimer">
        Important: EduSignage emergency features are a <em>communications
        layer</em>, not a replacement for fire alarms, PA systems, 911
        dispatch, or NFPA 72 / UL 2572 certified equipment. Every district
        should run drills with their primary safety systems first; treat
        EduSignage as a high-reliability secondary channel.
      </p>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Support page — final spread.
   ────────────────────────────────────────────────────────────────── */
function SupportPage() {
  return (
    <section className="guide-page">
      <PageHeader chapter="Support" title="Need a hand?" />
      <p className="guide-lede">
        We&rsquo;re a phone call away. Pilot districts get direct access to
        the engineering team — most replies under an hour during school
        hours.
      </p>

      <div className="guide-support-grid">
        <div className="guide-support-card">
          <h3>Help Center</h3>
          <p>Step-by-step articles, video walkthroughs, and a searchable knowledge base.</p>
          <p className="guide-support-link">edusignage.app/help</p>
        </div>
        <div className="guide-support-card">
          <h3>Email Support</h3>
          <p>Get a real human, not a ticket bot. Most replies within the school day.</p>
          <p className="guide-support-link">support@edusignage.app</p>
        </div>
        <div className="guide-support-card">
          <h3>Status Page</h3>
          <p>Live system health for every region. Bookmark this on every IT laptop.</p>
          <p className="guide-support-link">edusignage.app/status</p>
        </div>
        <div className="guide-support-card">
          <h3>Pilot Concierge</h3>
          <p>Dedicated onboarding manager during your first 90 days. Direct line on your welcome packet.</p>
          <p className="guide-support-link">In your welcome email</p>
        </div>
      </div>

      <p className="guide-thanks">
        Thank you for choosing EduSignage. We built this for every district
        that ever wished their school&rsquo;s signage just <em>worked</em>.
      </p>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────────── */
function PageHeader({ chapter, title }: { chapter: string; title: string }) {
  return (
    <header className="guide-page-header">
      <div className="guide-page-eyebrow">
        <span className="guide-page-mark" aria-hidden>
          <MonitorPlay className="w-4 h-4" strokeWidth={1.75} />
        </span>
        <span>{chapter}</span>
      </div>
      <h2 className="guide-page-title">{title}</h2>
      <hr className="guide-page-rule" />
    </header>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="guide-step">
      <div className="guide-step-num">{String(n).padStart(2, '0')}</div>
      <div className="guide-step-body">
        <h4 className="guide-step-title">{title}</h4>
        <p className="guide-step-copy">{children}</p>
      </div>
      <CheckCircle2 className="guide-step-check" />
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <aside className="guide-tip">
      <ArrowRight className="w-4 h-4 guide-tip-icon" />
      <div>{children}</div>
    </aside>
  );
}

/**
 * Live template embed identical to the marketing landing page —
 * iframes the static template HTML and scales it via transform so
 * fixed-pixel typography reads correctly inside the small frame.
 */
function TemplateTile({ src, name, tag, tagCls, desc }: { src: string; name: string; tag: string; tagCls: string; desc: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const iframe = el.querySelector('iframe');
      if (!iframe) return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const k = Math.min(r.width / 1920, r.height / 1080);
      iframe.style.transform = `scale(${k})`;
    };
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    const t1 = setTimeout(fit, 60);
    const t2 = setTimeout(fit, 400);
    return () => { ro?.disconnect(); clearTimeout(t1); clearTimeout(t2); };
  }, []);
  return (
    <div className="guide-template-tile">
      <div ref={ref} className="guide-template-frame">
        <iframe src={src} title={`${name} template preview`} loading="lazy" />
      </div>
      <div className="guide-template-meta">
        <div>
          <h4>{name}</h4>
          <p>{desc}</p>
        </div>
        <span className={`guide-template-chip guide-template-chip-${tagCls}`}>{tag}</span>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   All styles inline so the guide is self-contained — copying the
   page or printing it doesn't require any other CSS to load.
   ────────────────────────────────────────────────────────────────── */
function GuideStyles() {
  return (
    <style jsx global>{`
      @import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap');

      :root {
        --guide-ink: #0f172a;
        --guide-ink-soft: #475569;
        --guide-ink-faint: #94a3b8;
        --guide-bg: #ffffff;
        --guide-page-bg: #fafbfe;
        --guide-rule: #e2e8f0;
        --guide-accent: #6366f1;
        --guide-accent-2: #a855f7;
        --guide-accent-3: #d946ef;
      }

      .guide-root {
        background: var(--guide-page-bg);
        color: var(--guide-ink);
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
        font-size: 14px;
        line-height: 1.6;
        -webkit-font-smoothing: antialiased;
      }

      /* ─── Sticky controls bar ─── */
      .guide-controls {
        position: sticky; top: 0; z-index: 10;
        background: rgba(255,255,255,0.92);
        backdrop-filter: blur(12px);
        border-bottom: 1px solid var(--guide-rule);
      }
      .guide-controls-inner {
        max-width: 880px; margin: 0 auto;
        padding: 14px 24px;
        display: flex; align-items: center; justify-content: space-between; gap: 16px;
      }
      .guide-controls-meta { display: flex; flex-direction: column; }
      .guide-controls-eyebrow {
        font-size: 10px; font-weight: 700; letter-spacing: 0.16em;
        text-transform: uppercase; color: var(--guide-accent);
      }
      .guide-controls-title {
        font-family: 'Fredoka', sans-serif; font-weight: 600;
        font-size: 16px; color: var(--guide-ink);
      }
      .guide-controls-print {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 9px 16px; border-radius: 10px;
        background: linear-gradient(135deg, #4f46e5, #7c3aed);
        color: #fff; font-weight: 600; font-size: 13px; border: 0;
        cursor: pointer; box-shadow: 0 4px 14px rgba(99,102,241,0.32);
        transition: transform 0.15s, box-shadow 0.15s;
      }
      .guide-controls-print:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 20px rgba(99,102,241,0.42);
      }

      /* ─── Cover page ─── */
      .guide-cover {
        position: relative; overflow: hidden;
        min-height: 90vh;
        display: grid; place-items: center;
        padding: 48px 24px;
        page-break-after: always;
      }
      .guide-cover-bg {
        position: absolute; inset: 0; z-index: 0;
        background:
          radial-gradient(ellipse 60% 50% at 30% 30%, rgba(99,102,241,0.18), transparent 70%),
          radial-gradient(ellipse 55% 45% at 80% 70%, rgba(217,70,239,0.16), transparent 70%),
          linear-gradient(180deg, #fafbfe 0%, #fff 100%);
      }
      .guide-cover-stage {
        position: relative; z-index: 1; text-align: center;
        max-width: 720px;
      }
      .guide-cover-mark {
        width: 80px; height: 80px; margin: 0 auto 32px;
        border-radius: 24px;
        background: linear-gradient(135deg, var(--guide-accent), var(--guide-accent-2));
        display: grid; place-items: center;
        color: #fff;
        box-shadow: 0 16px 40px rgba(99,102,241,0.35);
      }
      .guide-cover-mark > svg { width: 38px; height: 38px; }
      .guide-cover-eyebrow {
        font-size: 12px; font-weight: 700; letter-spacing: 0.18em;
        text-transform: uppercase; color: var(--guide-accent);
        margin: 0 0 16px;
      }
      .guide-cover-title {
        font-family: 'Fredoka', sans-serif; font-weight: 600;
        font-size: clamp(40px, 6vw, 64px); line-height: 1.05;
        margin: 0 0 24px; color: var(--guide-ink);
        letter-spacing: -0.02em;
      }
      .guide-cover-grad {
        background: linear-gradient(135deg, var(--guide-accent) 0%, var(--guide-accent-2) 50%, var(--guide-accent-3) 100%);
        -webkit-background-clip: text; background-clip: text; color: transparent;
      }
      .guide-cover-lead {
        font-size: 18px; line-height: 1.55; color: var(--guide-ink-soft);
        max-width: 560px; margin: 0 auto;
      }
      .guide-cover-footer {
        position: absolute; bottom: 32px; left: 0; right: 0;
        display: flex; justify-content: center; gap: 12px;
        font-size: 12px; color: var(--guide-ink-faint);
        letter-spacing: 0.04em;
      }

      /* ─── Page (welcome / chapter / TOC / support) ─── */
      .guide-page {
        max-width: 760px; margin: 0 auto;
        padding: 56px 24px;
        page-break-after: always;
      }
      .guide-page-header { margin-bottom: 32px; }
      .guide-page-eyebrow {
        display: inline-flex; align-items: center; gap: 8px;
        font-size: 10px; font-weight: 700; letter-spacing: 0.16em;
        text-transform: uppercase; color: var(--guide-accent);
        margin: 0 0 10px;
      }
      .guide-page-mark {
        display: inline-flex; align-items: center; justify-content: center;
        width: 22px; height: 22px; border-radius: 6px;
        background: linear-gradient(135deg, var(--guide-accent), var(--guide-accent-2));
        color: #fff;
      }
      .guide-page-title {
        font-family: 'Fredoka', sans-serif; font-weight: 600;
        font-size: 36px; line-height: 1.1; letter-spacing: -0.018em;
        margin: 0 0 12px; color: var(--guide-ink);
      }
      .guide-page-rule {
        height: 3px; border: 0; margin: 0;
        background: linear-gradient(90deg, var(--guide-accent), transparent);
        width: 80px;
      }

      .guide-lede {
        font-size: 16px; line-height: 1.7; color: var(--guide-ink-soft);
        margin: 0 0 28px;
      }
      .guide-body { color: var(--guide-ink-soft); margin: 0 0 24px; }

      /* ─── Step list ─── */
      .guide-steps { display: flex; flex-direction: column; gap: 14px; margin-bottom: 28px; }
      .guide-step {
        display: grid; grid-template-columns: auto 1fr auto; gap: 18px;
        padding: 18px 22px;
        background: #fff;
        border: 1px solid var(--guide-rule);
        border-radius: 16px;
        align-items: start;
      }
      .guide-step-num {
        width: 36px; height: 36px; border-radius: 10px;
        background: linear-gradient(135deg, var(--guide-accent), var(--guide-accent-2));
        color: #fff;
        font-family: 'JetBrains Mono', monospace;
        font-weight: 600; font-size: 14px;
        display: grid; place-items: center;
        flex-shrink: 0;
      }
      .guide-step-title {
        margin: 4px 0 4px; font-size: 16px; font-weight: 600;
        font-family: 'Fredoka', sans-serif;
        color: var(--guide-ink);
      }
      .guide-step-copy { margin: 0; color: var(--guide-ink-soft); font-size: 14px; }
      .guide-step-copy code {
        font-family: 'JetBrains Mono', monospace;
        font-size: 12.5px;
        background: #f1f5f9;
        padding: 1px 6px; border-radius: 4px;
        color: #334155;
      }
      .guide-step-check { width: 18px; height: 18px; color: #10b981; margin-top: 8px; }

      /* ─── Tip callout ─── */
      .guide-tip {
        display: flex; gap: 12px;
        padding: 16px 20px;
        background: linear-gradient(180deg, #faf5ff 0%, #fdf2f8 100%);
        border: 1px solid #f3e8ff;
        border-left: 4px solid var(--guide-accent);
        border-radius: 12px;
        color: var(--guide-ink-soft); font-size: 13.5px; line-height: 1.6;
      }
      .guide-tip-icon { color: var(--guide-accent); margin-top: 3px; flex-shrink: 0; }

      /* ─── Welcome callouts ─── */
      .guide-callout-grid {
        display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
        margin-bottom: 24px;
      }
      .guide-callout {
        background: #fff; border: 1px solid var(--guide-rule);
        border-radius: 14px; padding: 20px;
      }
      .guide-callout h3 {
        font-family: 'Fredoka', sans-serif; font-weight: 600;
        font-size: 14px; margin: 0 0 12px; color: var(--guide-ink);
      }
      .guide-callout ul {
        margin: 0; padding: 0; list-style: none;
        display: flex; flex-direction: column; gap: 8px;
      }
      .guide-callout li {
        font-size: 13.5px; color: var(--guide-ink-soft);
        padding-left: 22px; position: relative; line-height: 1.55;
      }
      .guide-callout li::before {
        content: ''; position: absolute; left: 4px; top: 7px;
        width: 8px; height: 8px; border-radius: 50%;
        background: var(--guide-accent);
      }
      .guide-callout-accent { background: linear-gradient(180deg, #f5f3ff 0%, #fff 100%); border-color: #ede9fe; }

      .guide-toc-tip {
        display: inline-flex; align-items: center; gap: 8px;
        margin-top: 16px;
        padding: 10px 16px; border-radius: 999px;
        background: #f1f5f9; color: var(--guide-ink-soft);
        font-size: 13px;
      }
      .guide-toc-tip svg { color: var(--guide-accent); }

      /* ─── TOC list ─── */
      .guide-toc-list {
        list-style: none; padding: 0; margin: 0;
        display: flex; flex-direction: column; gap: 8px;
      }
      .guide-toc-list li {
        display: grid; grid-template-columns: auto auto 1fr auto; gap: 16px;
        align-items: center;
        padding: 16px 18px;
        background: #fff;
        border: 1px solid var(--guide-rule); border-radius: 14px;
      }
      .guide-toc-num {
        font-family: 'JetBrains Mono', monospace; font-weight: 600;
        font-size: 14px; color: var(--guide-ink-faint);
        width: 28px;
      }
      .guide-toc-icon {
        width: 36px; height: 36px; border-radius: 10px;
        background: linear-gradient(135deg, var(--guide-accent), var(--guide-accent-2));
        color: #fff;
        display: grid; place-items: center;
      }
      .guide-toc-body { display: flex; flex-direction: column; gap: 2px; }
      .guide-toc-title {
        font-family: 'Fredoka', sans-serif; font-weight: 600;
        font-size: 15px; color: var(--guide-ink);
      }
      .guide-toc-blurb {
        font-size: 12.5px; color: var(--guide-ink-soft);
      }
      .guide-toc-page {
        font-family: 'JetBrains Mono', monospace; font-weight: 500;
        font-size: 12px; color: var(--guide-ink-faint);
      }

      /* ─── Template embeds (Chapter 3) ─── */
      .guide-template-row {
        display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;
        margin: 24px 0;
      }
      .guide-template-tile {
        background: #fff; border: 1px solid var(--guide-rule);
        border-radius: 12px; overflow: hidden;
      }
      .guide-template-frame {
        position: relative;
        aspect-ratio: 16 / 9;
        background: #0f172a;
        overflow: hidden;
      }
      .guide-template-frame iframe {
        position: absolute; top: 0; left: 0;
        width: 1920px; height: 1080px;
        transform-origin: 0 0;
        border: 0;
        pointer-events: none;
        background: #0f172a;
      }
      .guide-template-meta {
        padding: 12px 14px;
        display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
      }
      .guide-template-meta h4 {
        margin: 0 0 2px; font-family: 'Fredoka', sans-serif; font-weight: 600;
        font-size: 14px; color: var(--guide-ink);
      }
      .guide-template-meta p {
        margin: 0; font-size: 11.5px; color: var(--guide-ink-soft);
        line-height: 1.4;
      }
      .guide-template-chip {
        font-size: 9px; font-weight: 700; letter-spacing: 0.08em;
        text-transform: uppercase;
        padding: 3px 8px; border-radius: 5px;
        flex-shrink: 0;
      }
      .guide-template-chip-es { background: #fef3c7; color: #92400e; }
      .guide-template-chip-ms { background: #dbeafe; color: #1e40af; }
      .guide-template-chip-hs { background: #fce7f3; color: #9d174d; }

      /* ─── Disclaimer ─── */
      .guide-disclaimer {
        margin-top: 28px; padding: 16px 20px;
        background: #fffbeb; border: 1px solid #fde68a;
        border-radius: 12px;
        font-size: 12.5px; line-height: 1.55; color: #78350f;
      }

      /* ─── Support ─── */
      .guide-support-grid {
        display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
        margin: 28px 0;
      }
      .guide-support-card {
        background: #fff; border: 1px solid var(--guide-rule);
        border-radius: 14px; padding: 18px 20px;
      }
      .guide-support-card h3 {
        margin: 0 0 6px;
        font-family: 'Fredoka', sans-serif; font-weight: 600;
        font-size: 15px; color: var(--guide-ink);
      }
      .guide-support-card p {
        margin: 0 0 8px; font-size: 13px; color: var(--guide-ink-soft); line-height: 1.55;
      }
      .guide-support-link {
        font-family: 'JetBrains Mono', monospace; font-weight: 500;
        font-size: 12px; color: var(--guide-accent);
        margin: 0;
      }
      .guide-thanks {
        margin: 36px 0 0; padding: 24px;
        text-align: center; font-size: 14.5px;
        color: var(--guide-ink-soft); font-style: italic;
        border-top: 1px solid var(--guide-rule);
      }

      /* ─── Print rules ─────────────────────────────────────────
         Browser Print to PDF flips on these. Hides the controls,
         normalizes margins, fits each chapter to its own sheet,
         and keeps the iframes from page-breaking down their middle. */
      @page {
        size: letter;
        margin: 0.6in;
      }
      @media print {
        body { background: #fff !important; }
        .guide-controls { display: none !important; }
        .guide-cover, .guide-page {
          padding: 24px 0 !important;
          page-break-after: always;
        }
        .guide-cover { min-height: auto; }
        .guide-step, .guide-callout, .guide-toc-list li,
        .guide-template-tile, .guide-support-card, .guide-tip, .guide-disclaimer {
          break-inside: avoid;
        }
        .guide-template-row {
          page-break-inside: avoid;
        }
      }
    `}</style>
  );
}

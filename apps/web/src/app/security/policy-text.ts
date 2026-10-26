/**
 * /security — "Report a security issue" — text in en / es / zh (2026-10-24).
 *
 * SERVER-ONLY content, like the help articles' `<slug>.<locale>.md`: the
 * page renders every language on the server and `LocaleVariant` shows the
 * reader's, so none of this text is in a JavaScript chunk (the English
 * catalog is inlined into the client bundle, which is under a ratcheted
 * budget). Tags: <mail>, <github>, <overview>, <network>, <dpa>, <txt> become
 * links. Keep the three languages shape-for-shape identical — same keys, same
 * list lengths, same tags and placeholders (security-text.test.ts).
 *
 * The commitments (acknowledge in 2 business days, assess in 10, fix targets
 * 30 / 90 days) are the ones SECURITY.md makes — change both together; the
 * test reads SECURITY.md to hold them in step. No certification claims: we
 * hold none (no SOC 2, ISO 27001 or FedRAMP), so the page names none.
 */
export interface SecurityPolicyText {
  title: string;
  eyebrow: string;
  lead: string;
  updated: string;
  sendVia: string;
  githubCta: string;
  publicWarning: string;
  commitTitle: string;
  stats: ReadonlyArray<{ value: string; label: string }>;
  sendTitle: string;
  sendIntro: string;
  send: ReadonlyArray<{ title: string; body: string }>;
  processTitle: string;
  steps: ReadonlyArray<{ title: string; body: string }>;
  bountyNote: string;
  harborTitle: string;
  harborIntro: string;
  harbor: readonly string[];
  harborLimits: string;
  scopeTitle: string;
  inScopeTitle: string;
  inScope: readonly string[];
  priorityTitle: string;
  priority: readonly string[];
  outTitle: string;
  outOfScope: readonly string[];
  rulesTitle: string;
  rules: readonly string[];
  reviewsTitle: string;
  reviewsBody: string;
  machineReadable: string;
}

const en: SecurityPolicyText = {
  title: 'Report a security issue',
  eyebrow: 'Vulnerability disclosure',
  lead:
    'Found a weakness in VenueOS? Tell us privately. The same screens that show a lunch menu can show a lockdown alert, so a person on our team picks up every report quickly — and good-faith research that follows this page is welcome, never punished.',
  updated: 'Last updated {date}',
  sendVia: 'Send your report privately',
  githubCta: 'Report privately on GitHub',
  publicWarning:
    'Please never post details in a public GitHub issue, pull request or discussion, or on social media. That tells attackers before a fix ships.',
  commitTitle: 'What we commit to',
  stats: [
    { value: '2 business days', label: 'to acknowledge your report' },
    { value: '10 business days', label: 'to assess it and rate its severity' },
    { value: '30 days', label: 'fix target for critical and high severity' },
    { value: '90 days', label: 'fix target for medium and low severity' },
  ],
  sendTitle: 'What to send',
  sendIntro: 'Send what you have. A rough report is better than none, and we will ask if we need more.',
  send: [
    { title: 'What you found', body: 'The issue, and the impact you believe it has.' },
    { title: 'How to reproduce it', body: 'Steps, a proof of concept, a request and its response, or a short video.' },
    { title: 'Where it is', body: 'The affected address, endpoint or app version.' },
    { title: 'What you touched', body: 'Whether you accessed, changed or kept any data that is not yours.' },
  ],
  processTitle: 'What happens next',
  steps: [
    { title: 'We confirm we have it', body: 'Within 2 business days, a person on our team replies to your report.' },
    {
      title: 'We assess it',
      body: 'Within 10 business days, we confirm the issue, rate its severity and tell you what we found.',
    },
    {
      title: 'We fix it',
      body: 'Our target is 30 days from triage for critical and high severity, and 90 days for medium and low.',
    },
    { title: 'We keep you posted', body: 'If we are going to miss one of these dates, we tell you rather than go quiet.' },
    {
      title: 'We disclose it together',
      body: 'We agree the timing of any public disclosure with you, normally after the fix ships, and we credit you unless you ask us not to.',
    },
  ],
  bountyNote: 'We do not run a paid bug bounty.',
  harborTitle: 'Safe harbor',
  harborIntro: 'If you make a good-faith effort to follow this page, we will:',
  harbor: [
    'consider your research authorized, including under the U.S. Computer Fraud and Abuse Act and similar laws;',
    'waive any Terms of Service restriction that would otherwise prohibit it, for that limited purpose;',
    'not pursue or support legal action against you; and',
    'make it clear that your research was authorized if a third party takes action against you.',
  ],
  harborLimits:
    'This does not cover accessing real customer data, triggering a real emergency alert, or breaking the rules below. Not sure whether something is in scope? Ask first at <mail>security@venue-os.app</mail>.',
  scopeTitle: 'Scope',
  inScopeTitle: 'In scope',
  inScope: [
    'The dashboard and web player at venue-os.app',
    'The VenueOS API',
    'The VenueOS Android player and manager apps',
    'The source code and build pipeline in our public GitHub repository',
  ],
  priorityTitle: 'What matters most to us',
  priority: [
    'Taking over a screen — showing content its owner did not choose.',
    'Suppressing or forging an emergency alert. This is the most serious class of issue for VenueOS.',
    "Reading or changing another organization's data.",
    'Reaching an admin capability from a lower role, or from no account at all.',
    'Reaching student or staff information.',
  ],
  outTitle: 'Out of scope',
  outOfScope: [
    'Missing security headers with no demonstrated exploit.',
    'Rate limiting on endpoints that are neither sign-in nor destructive.',
    'Clickjacking on pages with no state-changing action.',
    'Self-XSS, or attacks that need an already-compromised device or browser.',
    'Social engineering of our staff or customers.',
    'Denial of service through traffic volume.',
    'Automated scanner output without a verified, reproducible impact.',
    'Issues in third-party services we use — report them to that provider, and tell us too if our customers are affected.',
    'Findings that need physical access to a device that is already unlocked, unless they get past the kiosk lockdown itself.',
  ],
  rulesTitle: 'Rules of engagement',
  rules: [
    'Use your own trial account and your own data — never a live school or business.',
    "Do not access, change, delete or keep data that is not yours. If you reach someone else's data by accident, stop and tell us what you saw.",
    'Never trigger an emergency alert on a real deployment. Tell us how, and we will reproduce it ourselves in an isolated account.',
    'No denial of service, stress testing or spam.',
    'No physical intrusion and no social engineering.',
    'Stop at proof: demonstrate the issue, then stop — do not pivot, escalate further or stay in.',
  ],
  reviewsTitle: 'Security reviews and questionnaires',
  reviewsBody:
    'For a procurement or district security review, email <mail>security@venue-os.app</mail>. Our <overview>security overview for IT teams</overview> and <network>network requirements</network> answer most first questions, and the <dpa>Data Processing Addendum</dpa> lists every sub-processor.',
  machineReadable: 'This page is also published in machine-readable form at <txt>/.well-known/security.txt</txt>.',
};

const es: SecurityPolicyText = {
  title: 'Reportar un problema de seguridad',
  eyebrow: 'Divulgación de vulnerabilidades',
  lead:
    '¿Encontró una debilidad en VenueOS? Avísenos en privado. Las mismas pantallas que muestran el menú del almuerzo pueden mostrar una alerta de confinamiento, así que una persona de nuestro equipo atiende cada reporte con rapidez — y la investigación de buena fe que sigue esta página es bienvenida, nunca castigada.',
  updated: 'Última actualización: {date}',
  sendVia: 'Envíe su reporte en privado',
  githubCta: 'Reportar en privado en GitHub',
  publicWarning:
    'Nunca publique detalles en un issue, una solicitud de cambios (pull request) o una discusión pública de GitHub, ni en redes sociales. Eso alerta a los atacantes antes de que exista una corrección.',
  commitTitle: 'Nuestros compromisos',
  stats: [
    { value: '2 días hábiles', label: 'para acusar recibo de su reporte' },
    { value: '10 días hábiles', label: 'para evaluarlo y clasificar su gravedad' },
    { value: '30 días', label: 'objetivo de corrección para gravedad crítica y alta' },
    { value: '90 días', label: 'objetivo de corrección para gravedad media y baja' },
  ],
  sendTitle: 'Qué enviar',
  sendIntro: 'Envíe lo que tenga. Un reporte incompleto es mejor que ninguno, y le preguntaremos si necesitamos más.',
  send: [
    { title: 'Qué encontró', body: 'El problema y el impacto que cree que tiene.' },
    { title: 'Cómo reproducirlo', body: 'Pasos, una prueba de concepto, una solicitud y su respuesta, o un video corto.' },
    { title: 'Dónde está', body: 'La dirección, el endpoint o la versión de la app afectados.' },
    { title: 'Qué tocó', body: 'Si accedió, cambió o guardó datos que no son suyos.' },
  ],
  processTitle: 'Qué pasa después',
  steps: [
    {
      title: 'Confirmamos que lo recibimos',
      body: 'En un máximo de 2 días hábiles, una persona de nuestro equipo responde a su reporte.',
    },
    {
      title: 'Lo evaluamos',
      body: 'En un máximo de 10 días hábiles, confirmamos el problema, clasificamos su gravedad y le contamos lo que encontramos.',
    },
    {
      title: 'Lo corregimos',
      body: 'Nuestro objetivo es 30 días desde la clasificación para gravedad crítica y alta, y 90 días para media y baja.',
    },
    {
      title: 'Lo mantenemos al tanto',
      body: 'Si no vamos a cumplir alguna de estas fechas, se lo decimos en lugar de quedarnos callados.',
    },
    {
      title: 'Lo divulgamos juntos',
      body: 'Acordamos con usted el momento de cualquier divulgación pública, normalmente después de publicar la corrección, y le damos crédito salvo que nos pida lo contrario.',
    },
  ],
  bountyNote: 'No tenemos un programa de recompensas pagadas.',
  harborTitle: 'Puerto seguro',
  harborIntro: 'Si hace un esfuerzo de buena fe por seguir esta página:',
  harbor: [
    'consideraremos autorizada su investigación, también conforme a la Ley de Fraude y Abuso Informático de EE. UU. (CFAA) y leyes similares;',
    'renunciaremos, solo para ese fin, a cualquier restricción de los Términos del servicio que la prohíba;',
    'no emprenderemos ni apoyaremos acciones legales en su contra; y',
    'dejaremos claro que su investigación estaba autorizada si un tercero emprende acciones en su contra.',
  ],
  harborLimits:
    'Esto no cubre acceder a datos reales de clientes, activar una alerta de emergencia real ni incumplir las reglas de abajo. ¿No sabe si algo está dentro del alcance? Pregunte primero en <mail>security@venue-os.app</mail>.',
  scopeTitle: 'Alcance',
  inScopeTitle: 'Dentro del alcance',
  inScope: [
    'El panel y el reproductor web en venue-os.app',
    'La API de VenueOS',
    'Las apps de VenueOS para Android (reproductor y administrador)',
    'El código fuente y el proceso de compilación de nuestro repositorio público en GitHub',
  ],
  priorityTitle: 'Lo que más nos importa',
  priority: [
    'Tomar el control de una pantalla: mostrar contenido que su dueño no eligió.',
    'Suprimir o falsificar una alerta de emergencia. Es el tipo de problema más grave para VenueOS.',
    'Leer o cambiar datos de otra organización.',
    'Llegar a una función de administrador desde un rol menor o sin cuenta.',
    'Llegar a información de estudiantes o del personal.',
  ],
  outTitle: 'Fuera del alcance',
  outOfScope: [
    'Encabezados de seguridad faltantes sin un ataque demostrado.',
    'Límites de frecuencia en endpoints que no son de inicio de sesión ni destructivos.',
    'Clickjacking en páginas sin acciones que cambien algo.',
    'Self-XSS, o ataques que requieren un dispositivo o navegador ya comprometido.',
    'Ingeniería social contra nuestro personal o clientes.',
    'Denegación de servicio por volumen de tráfico.',
    'Resultados de escáneres automáticos sin un impacto verificado y reproducible.',
    'Problemas en servicios de terceros que usamos: repórtelos a ese proveedor y avísenos también si afectan a nuestros clientes.',
    'Hallazgos que requieren acceso físico a un dispositivo ya desbloqueado, salvo que superen el propio bloqueo del quiosco.',
  ],
  rulesTitle: 'Reglas de participación',
  rules: [
    'Use su propia cuenta de prueba y sus propios datos — nunca una escuela o empresa real.',
    'No acceda, cambie, borre ni guarde datos que no son suyos. Si llega por accidente a datos de otra persona, deténgase y díganos qué vio.',
    'Nunca active una alerta de emergencia en una instalación real. Díganos cómo y la reproduciremos nosotros en una cuenta aislada.',
    'Nada de denegación de servicio, pruebas de estrés ni spam.',
    'Nada de intrusión física ni ingeniería social.',
    'Deténgase en la prueba: demuestre el problema y pare — no pivote, no escale más ni se quede dentro.',
  ],
  reviewsTitle: 'Revisiones y cuestionarios de seguridad',
  reviewsBody:
    'Para una revisión de seguridad de compras o del distrito, escriba a <mail>security@venue-os.app</mail>. Nuestro <overview>resumen de seguridad para equipos de TI</overview> y los <network>requisitos de red</network> responden la mayoría de las primeras preguntas, y la <dpa>Adenda de procesamiento de datos</dpa> enumera todos los subencargados.',
  machineReadable: 'Esta página también se publica en formato legible por máquinas en <txt>/.well-known/security.txt</txt>.',
};

const zh: SecurityPolicyText = {
  title: '报告安全问题',
  eyebrow: '漏洞披露',
  lead:
    '发现了 VenueOS 的安全弱点？请私下告诉我们。显示午餐菜单的同一块屏幕也会显示封锁警报，因此每一份报告都会很快由我们团队的专人跟进；遵守本页规则的善意研究，我们欢迎，绝不追究。',
  updated: '最后更新：{date}',
  sendVia: '请私下发送您的报告',
  githubCta: '在 GitHub 上私密报告',
  publicWarning: '请勿在 GitHub 的公开 issue、拉取请求或讨论中，或在社交媒体上发布任何细节——这会在修复发布之前提醒攻击者。',
  commitTitle: '我们的承诺',
  stats: [
    { value: '2 个工作日', label: '确认收到您的报告' },
    { value: '10 个工作日', label: '完成评估并确定严重程度' },
    { value: '30 天', label: '严重和高危问题的修复目标' },
    { value: '90 天', label: '中危和低危问题的修复目标' },
  ],
  sendTitle: '请提供以下内容',
  sendIntro: '有多少就发多少。粗略的报告也比没有好；如需更多信息，我们会再问您。',
  send: [
    { title: '您发现了什么', body: '问题是什么，以及您认为它的影响。' },
    { title: '如何复现', body: '复现步骤、概念验证、一次请求及其响应，或一段短视频均可。' },
    { title: '问题在哪里', body: '受影响的地址、接口或应用版本。' },
    { title: '您接触了什么', body: '您是否访问、修改或保留了不属于您的数据。' },
  ],
  processTitle: '接下来会发生什么',
  steps: [
    { title: '确认收到', body: '2 个工作日内，我们团队会有专人回复您的报告。' },
    { title: '评估问题', body: '10 个工作日内，我们会确认问题、确定严重程度，并告诉您我们的发现。' },
    { title: '修复问题', body: '严重和高危问题的修复目标为定级后 30 天内，中危和低危问题为 90 天内。' },
    { title: '随时告知进展', body: '如果我们无法按期完成，会主动告诉您，而不是沉默。' },
    { title: '共同披露', body: '任何公开披露的时间都会与您商定，通常在修复发布之后；除非您要求不署名，我们会向您公开致谢。' },
  ],
  bountyNote: '我们不设有偿漏洞赏金计划。',
  harborTitle: '安全港',
  harborIntro: '只要您善意地努力遵守本页规则，我们将：',
  harbor: [
    '视您的研究为已获授权，包括依据美国《计算机欺诈和滥用法》（CFAA）及类似法律；',
    '仅为此有限目的，豁免服务条款中原本会禁止该研究的任何限制；',
    '不对您提起或支持任何法律行动；以及',
    '如有第三方对您采取行动，明确表示您的研究已获授权。',
  ],
  harborLimits:
    '安全港不涵盖访问真实客户数据、触发真实紧急警报或违反下方规则的行为。不确定是否在范围内？请先发送邮件至 <mail>security@venue-os.app</mail> 询问。',
  scopeTitle: '范围',
  inScopeTitle: '范围之内',
  inScope: [
    'venue-os.app 上的管理后台和网页播放器',
    'VenueOS API',
    'VenueOS Android 播放器和管理应用',
    '我们 GitHub 公开代码库中的源代码和构建流程',
  ],
  priorityTitle: '我们最关心的问题',
  priority: [
    '接管屏幕 —— 显示屏幕所有者未选择的内容。',
    '压制或伪造紧急警报。这是 VenueOS 最严重的一类问题。',
    '读取或修改其他组织的数据。',
    '从较低角色或未登录状态获得管理员能力。',
    '获取学生或员工信息。',
  ],
  outTitle: '范围之外',
  outOfScope: [
    '缺少安全响应头，但没有可演示的利用方式。',
    '非登录、非破坏性接口的频率限制。',
    '没有状态变更操作的页面上的点击劫持。',
    'Self-XSS，或需要设备或浏览器已被攻陷的攻击。',
    '针对我们员工或客户的社会工程。',
    '依靠流量规模的拒绝服务攻击。',
    '未经验证、无法复现影响的自动扫描结果。',
    '我们所使用的第三方服务中的问题 —— 请报告给该服务商；如影响我们的客户，也请告诉我们。',
    '需要实际接触一台已解锁设备才能成立的发现 —— 除非它能突破信息亭锁定本身。',
  ],
  rulesTitle: '测试规则',
  rules: [
    '使用您自己的试用账户和自己的数据 —— 绝不针对真实的学校或企业。',
    '不要访问、修改、删除或保留不属于您的数据。如果意外接触到他人数据，请立即停止并告诉我们您看到了什么。',
    '绝不在真实部署上触发紧急警报。请告诉我们方法，我们会在隔离账户中自行复现。',
    '禁止拒绝服务、压力测试或发送垃圾信息。',
    '禁止物理入侵和社会工程。',
    '点到为止：证明问题后立即停止 —— 不要横向移动、进一步提权或保持驻留。',
  ],
  reviewsTitle: '安全审查与问卷',
  reviewsBody:
    '如需进行采购或学区安全审查，请发送邮件至 <mail>security@venue-os.app</mail>。我们的<overview>面向 IT 团队的安全概览</overview>和<network>网络要求</network>可以回答大多数初步问题，<dpa>数据处理附录</dpa>列出了全部次级处理方。',
  machineReadable: '本页同时以机器可读格式发布于 <txt>/.well-known/security.txt</txt>。',
};

export const SECURITY_POLICY_TEXT: Record<'en' | 'es' | 'zh', SecurityPolicyText> = { en, es, zh };

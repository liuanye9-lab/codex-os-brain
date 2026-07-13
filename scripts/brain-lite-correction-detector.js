'use strict';

const INJECTED_TAGS = [
  'brain-context', 'honest-loop-protocol', 'system-reminder', 'command-name',
  'agent-context', 'memory-context', 'tool-context'
];

const PATTERNS = {
  false_success: [
    /(?:你|您).{0,8}(?:说|刚说).{0,8}(?:已经|都)?(?:搞定|完成|修好|解决|弄好).{0,24}(?:结果|实际|根本|可是|但).{0,12}(?:还是|没|不行|失败|不对)/i,
    /(?:哪里|哪儿)(?:好了|修好了|完成了|解决了)/i,
    /(?:又|还)(?:谎报|骗我|假装)(?:成功|好了|完成)?/i,
    /根本没(?:修好|完成|搞定|解决)/i,
    /you (?:said|claimed).{0,24}(?:fixed|done|completed|working).{0,24}(?:but|yet).{0,16}(?:still|not|fails?|broken)/i,
    /(?:it is|it's) not (?:fixed|done|working)/i,
  ],
  abandon_signal: [
    /(?:^|[，,。!！\s])算了(?:吧|，|,|。|!|！|\s|$)/m,
    /随便(?:吧|你)/,
    /(?:不要|别)再(?:这样|犯|说|搞)/,
    /我不(?:管|想说|想问)了/,
    /forget it|never mind|stop doing this/i,
  ],
  explicit_correction: [
    /不是这样|又犯|又这样|搞错了|纠正你|你错了|不对|完全错误/,
    /(?:为什么|为啥)(?:你|它|agent).{0,6}(?:总是|又|这样|又一次)/i,
    /that's not what i asked|you got it wrong|this is wrong|incorrect/i,
  ],
  implicit_rephrase: [
    /(?:我|你)之前(?:说|告诉|提过|讲过)过?/,
    /你(?:应该|不应该)/,
    /我(?:发现|觉得|跟你说)你(?:每次|总是|又|这样)/,
    /i (?:already|previously) (?:said|told|asked)/i,
    /you should(?:n't| not)?/i,
  ],
};

const POSITIVE = [
  /你做得(?:很)?好|完美|你说得对|这次(?:对了|做对了)|做得不错/,
  /(?:这版|这次|这个).{0,20}(?:更好|不错|正确)/,
  /^(?:好的|没错|对的|完美|搞定|可以|行)[，,。!！?？\s]*$/m,
  /^(?:great|correct|perfect|looks good|that works)[.!\s]*$/i,
];

function stripInjectedContent(text) {
  let output = String(text || '');
  for (const tag of INJECTED_TAGS) {
    const pair = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
    const single = new RegExp(`<${tag}\\b[^>]*\\/?>(?:[^\\n]*)?`, 'gi');
    output = output.replace(pair, '').replace(single, '');
  }
  return output.replace(/\n{3,}/g, '\n\n').trim();
}

function hits(patterns, text) {
  return patterns.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
}

function detectCorrection(input) {
  const text = stripInjectedContent(input);
  if (!text) return { matched: false, trigger: null, severity: null, confidence: 0, signals: [] };
  if (hits(POSITIVE, text).length > 0) return { matched: false, trigger: null, severity: null, confidence: 0, signals: [] };

  for (const trigger of ['false_success', 'abandon_signal', 'explicit_correction']) {
    const signals = hits(PATTERNS[trigger], text);
    if (signals.length > 0) {
      return {
        matched: true,
        trigger,
        severity: trigger === 'false_success' || trigger === 'abandon_signal' ? 'high' : 'mid',
        confidence: trigger === 'false_success' ? 0.95 : trigger === 'abandon_signal' ? 0.9 : 0.85,
        signals,
      };
    }
  }

  const weakSignals = hits(PATTERNS.implicit_rephrase, text);
  if (weakSignals.length >= 2) {
    return { matched: true, trigger: 'implicit_rephrase', severity: 'mid', confidence: 0.72, signals: weakSignals };
  }
  return { matched: false, trigger: null, severity: null, confidence: 0, signals: weakSignals };
}

module.exports = { detectCorrection, stripInjectedContent, PATTERNS };

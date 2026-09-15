function normalize(text) {
  return String(text || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function titleCase(s) {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

// Best-effort merchant/payee name from a raw narration, used both as the
// default description and as the pattern when the user asks to remember a mapping.
function merchantKey(narration) {
  let s = String(narration || '').replace(/\(Ref#[^)]*\)/gi, '').trim();
  if (/^UPI-/i.test(s)) {
    const parts = s.split('-');
    s = parts[1] || s;
  } else if (/^(PAYU|RAZORPAY|RAZ|RSP)\*/i.test(s)) {
    s = s.replace(/^[A-Z]+\*/i, '');
  }
  s = s.replace(/\s{2,}.*$/, '').replace(/\s+/g, ' ').trim();
  return normalize(s);
}

function suggestDescription(narration) {
  const key = merchantKey(narration);
  return key ? titleCase(key) : String(narration || '').slice(0, 40);
}

function findRule(rules, narration, direction) {
  const text = normalize(narration);
  let best = null;
  for (const rule of rules) {
    if (rule.direction && rule.direction !== direction) continue;
    if (!text.includes(normalize(rule.pattern))) continue;
    if (!best || rule.priority > best.priority || (rule.priority === best.priority && rule.pattern.length > best.pattern.length)) {
      best = rule;
    }
  }
  return best;
}

// Returns the mapped fields for a parsed transaction.
function applyRules(rules, txn) {
  const rule = findRule(rules, txn.narration, txn.direction);
  if (rule) {
    return {
      type: rule.type || (txn.direction === 'credit' ? 'Income' : 'Expense'),
      category: rule.category || (txn.direction === 'credit' ? 'Credit' : ''),
      description: rule.description || suggestDescription(txn.narration),
      details: rule.details || '',
      include_row: rule.ignore ? 0 : 1,
      auto_mapped: 1,
    };
  }
  return {
    type: txn.direction === 'credit' ? 'Income' : 'Expense',
    category: txn.direction === 'credit' ? 'Credit' : '',
    description: suggestDescription(txn.narration),
    details: '',
    include_row: 1,
    auto_mapped: 0,
  };
}

module.exports = { normalize, merchantKey, suggestDescription, findRule, applyRules };

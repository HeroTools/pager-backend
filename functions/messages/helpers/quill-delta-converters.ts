function encodeLink(link: string): string {
  try {
    const url = new URL(link);
    url.searchParams.delete('response-content-disposition');
    return url.toString();
  } catch {
    return encodeURI(link);
  }
}

class Node {
  public open: string;
  public close: string;
  public text: string;
  public children: Node[];
  public _parent?: Node;
  public _format?: string;

  constructor(data?: string | [string, string]) {
    this.open = '';
    this.close = '';
    this.text = '';
    this.children = [];

    if (Array.isArray(data)) {
      this.open = data[0] || '';
      this.close = data[1] || '';
    } else if (typeof data === 'string') {
      this.text = data;
    }
  }

  append(child: Node | string): void {
    const node = child instanceof Node ? child : new Node(child);
    if (node._parent) {
      const sib = node._parent.children;
      const idx = sib.indexOf(node);
      if (idx > -1) sib.splice(idx, 1);
    }
    node._parent = this;
    this.children.push(node);
  }

  render(): string {
    let out = this.open;
    if (this.text) out += this.text;
    for (const c of this.children) {
      out += c.render();
    }
    out += this.close;
    return out;
  }

  parent(): Node | undefined {
    return this._parent;
  }
}

interface Converters {
  embed: Record<string, (this: Node, src: any, attrs?: any) => void>;
  inline: Record<string, (value?: any) => [string, string]>;
  block: Record<string, any>;
}

const defaultConverters: Converters = {
  embed: {
    image(this: Node, src: string) {
      this.append(`![](${encodeLink(src)})`);
    },
    thematic_break(this: Node) {
      this.open = '\n---\n' + this.open;
    },
    mention(this: Node, data: { id: string }) {
      this.append(`<@${data.id}>`);
    },
  },

  inline: {
    bold: () => ['**', '**'],
    italic: () => ['*', '*'],
    underline: () => ['_', '_'],
    strike: () => ['~~', '~~'],
    code: () => ['`', '`'],
    link: (url: string) => ['[', `](${encodeLink(url)})`],
  },

  block: {
    header(this: Node, attrs: { header: number }) {
      this.open = '#'.repeat(attrs.header) + ' ' + this.open;
    },
    blockquote(this: Node) {
      this.open = '> ' + this.open;
    },
    'code-block'(this: Node, attrs: { 'code-block': string | boolean }) {
      const lang = attrs['code-block'] === true ? '' : attrs['code-block'];
      this.open = '```' + lang + '\n' + this.open;
      this.close = this.close + '\n```';
    },
    list: {
      group: () => new Node(['', '\n']),
      line(this: Node, attrs: { list: string; indent?: number }, group: any) {
        const indent = '  '.repeat(attrs.indent || 0);
        if (attrs.list === 'bullet') {
          this.open = indent + '- ' + this.open;
        } else if (attrs.list === 'checked') {
          this.open = indent + '- [x] ' + this.open;
        } else if (attrs.list === 'unchecked') {
          this.open = indent + '- [ ] ' + this.open;
        } else if (attrs.list === 'ordered') {
          group.count = (group.count || 0) + 1;
          this.open = indent + group.count + '. ' + this.open;
        }
      },
    },
  },
};

interface QuillOp {
  insert?: string | Record<string, any>;
  attributes?: Record<string, any>;
}

export function deltaToMarkdown(
  ops: QuillOp[],
  converters: Converters = defaultConverters,
): string {
  return convert(ops, converters).render().replace(/\s+$/, '') + '\n';
}

function convert(ops: QuillOp[], converters: Converters): Node {
  let group: any, line!: Node, el!: Node, activeInline: Record<string, any>;
  let beginningOfLine = false;
  const root = new Node();

  function newLine() {
    line = new Node(['', '\n']);
    el = line;
    root.append(line);
    activeInline = {};
  }

  newLine();

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];

    if (op.insert && typeof op.insert === 'object') {
      for (const key in op.insert) {
        if (converters.embed[key]) {
          applyInlineAttributes(op.attributes);
          converters.embed[key].call(el, op.insert[key], op.attributes);
        }
      }
      continue;
    }

    if (typeof op.insert === 'string') {
      const lines = op.insert.split('\n');
      const attrs = op.attributes || {};

      if (Object.keys(attrs).some((k) => converters.block[k])) {
        for (let j = 1; j < lines.length; j++) {
          for (const attr in attrs) {
            const conv = converters.block[attr];
            if (conv) {
              let fn = conv;
              if (typeof conv === 'object') {
                if (group && group.type !== attr) group = null;
                if (!group && conv.group) {
                  group = { el: conv.group(), type: attr, count: 0, distance: 0 };
                  root.append(group.el);
                }
                if (group) {
                  group.el.append(line);
                  group.distance = 0;
                }
                fn = conv.line;
              }
              fn.call(line, attrs, group);
              newLine();
              break;
            }
          }
        }
        beginningOfLine = true;
      } else {
        for (let l = 0; l < lines.length; l++) {
          if ((l > 0 || beginningOfLine) && group && ++group.distance >= 2) {
            group = null;
          }
          applyInlineAttributes(attrs, ops[i + 1]?.attributes);
          el.append(lines[l]);
          if (l < lines.length - 1) newLine();
        }
        beginningOfLine = false;
      }
    }
  }

  return root;

  function applyInlineAttributes(attrs: Record<string, any> = {}, next: Record<string, any> = {}) {
    const first: string[] = [],
      then: string[] = [];
    let tag = el;
    const seen: Record<string, boolean> = {};

    while (tag._format) {
      seen[tag._format] = true;
      if (!attrs[tag._format]) {
        for (const f in seen) delete activeInline[f];
        el = tag.parent()!;
      }
      tag = tag.parent()!;
    }

    for (const fmt in attrs) {
      if (!converters.inline[fmt]) continue;
      if (activeInline[fmt] === attrs[fmt]) continue;
      (attrs[fmt] === next[fmt] ? first : then).push(fmt);
      activeInline[fmt] = attrs[fmt];
    }

    [...first, ...then].forEach(applyFormat);

    function applyFormat(fmt: string) {
      const [open, close] = converters.inline[fmt](attrs[fmt]);
      const node = new Node([open, close]);
      node._format = fmt;
      el.append(node);
      el = node;
    }
  }
}

export function deltaToPlainText(delta: string | { ops: QuillOp[] }): string {
  let ops: QuillOp[];
  if (typeof delta === 'string') {
    try {
      ops = JSON.parse(delta).ops || [];
    } catch {
      return '';
    }
  } else {
    ops = delta.ops || [];
  }
  const md = deltaToMarkdown(ops);
  return md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\>\s+/gm, '')
    .replace(/```[\s\S]*?```/g, '[Code Block]')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '[Image]')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

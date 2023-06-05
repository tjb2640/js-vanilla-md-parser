let MarkdownParser = (() => {

    // TODO: See in which places a `${format}` might be slightly faster than a + concat

    // Reassigned in this.reset()
    let state = {};

    /**
     * Represents inline styling like **bold** or ~~strikethrough~~
     * 
     * The order in which the objects appear in the array here is the order in which they're parsed out.
     * In general, don't include similar characters in the .tag that are already in the .original
     * (With markup that stipulation shouldn't matter anyway)
     * 
     * TODO: for strong, strong, and em, use a workaround for Safari for lookbehind. Safari for whatever reason still doesn't
     * support lookbehind!
     */
    const INLINE = [
        // Following four will lazy match groups of text wrapped in .original and negative lookbehind for a backslash
        {
            original: '**',
            matcher: /(?<!\\)[\*]{2}(.+?)(?<!\\)[\*]{2}/g, 
            tag: 'strong',
        },
        {
            original: '__',
            matcher: /(?<!\\)[_]{2}(.+?)(?<!\\)[_]{2}/g,
            tag: 'strong',
        },
        {
            original: '*',
            matcher: /(?<!\\)[\*]{1}(.+?)(?<!\\)[\*]{1}/g,
            tag: 'em',
        },
        {
            original: '_',
            matcher: /(?<!\\)[_]{1}(.+?)(?<!\\)[_]{1}/g,
            tag: 'em',
        },
    ];

    const SANITIZE_REPLACEMENTS = {
        ['<']: '&lt;',
        ['>']: '&gt;',
    };

    /**
     * Represents information about leaf and container block classes (headers, blockquotes, etc.) and provides parsers
     * 
     * Each `parse` function returns a 2-length array: [0] = parsed text, [1] = last modified line index in raw_lines
     */
    const BLOCK = {
        blockquote: {
            parse: (raw_lines, i, line_start_pos, parsed_lines, matched) => { /* handled inside parseMarkdown */ },
        },
        code_container_marker: {
            parse: (raw_lines, i, line_start_pos, parsed_lines, matched) => { /* handled inside parseMarkdown */ },
        },
        break: {
            parse: (raw_lines, i, line_start_pos, parsed_lines, matched) => ['<br />', i],
        },
        atx_heading: {
            parse: (raw_lines, i, line_start_pos, parsed_lines, matched) => {
                const len = matched.trim().length
                return [wrapWithTag('h' + len, raw_lines[i].substring(line_start_pos)
                    .replace(new RegExp(matched), '').trim()), i];
            },
        },
        setext_heading: {
            parse: (raw_lines, i, line_start_pos, parsed_lines, matched) => {
                const tag = matched.indexOf('=') > -1 ? 'h1' : 'h2';
                if (parsed_lines.length > 0) {
                    parsed_lines[parsed_lines.length-1] = wrapWithTag(tag, parsed_lines[parsed_lines.length-1]);
                }
            },
        },
        plaintext: {
            parse: (raw_lines, i, line_start_pos, parsed_lines, matched) => {
                return [raw_lines[i].substring(line_start_pos), i]; // backparse paragraphs later
            },
        },
    };

    /**
     * [0] = regex matcher, [1] = associated `BLOCK` object w/parser
     */
    const BLOCK_MATCHERS = [
        [/```/g, BLOCK.code_container_marker], // The start or end of a code container.
        [/^\s*#{1,6}/g, BLOCK.atx_heading], // ### ATX-style heading with 1-6 levels
        [/(^=+\s*$)|(^-+\s*$)/g, BLOCK.setext_heading], // setext-style heading (prev. line underscored with === or ---)
        [/^(>+\s*)/g, BLOCK.blockquote],
    ];



    function escapeHTMLChars(text = '') {
        text = text.replace('&', '&amp;');
        for (const k in SANITIZE_REPLACEMENTS) {
            text = text.replace(k, SANITIZE_REPLACEMENTS[k]);
        }
        return text;
    }

    /**
     * Wrap the text using the given HTML tag.
     * 
     * @param {string} [tag='p']
     * @param {string} [text='']
     * @return {*} 
     */
    function wrapWithTag(tag = 'p', text = '') {
        // Concatenation here is mildly quicker than a full string.format due to .format's extra overhead...
        return '<' + tag + '>' + escapeHTMLChars(text) + '</' + tag + '>';
    }

    function isEmpty(str = '') {
        return str.trim().length == 0;
    }



    /**
     * 
     * @param {string} line A line in the markdown to determine the block type of
     * @returns {object} a value in the `BLOCK` table containing a block parser for the given line
     */
    function getBlockInfo(line, start_pos) {
        if (isEmpty(line.substring(start_pos))) {
            return [BLOCK.break, 0];
        }

        for (let i = 0; i < BLOCK_MATCHERS.length; i++) {
            const matcher = BLOCK_MATCHERS[i][0];
            const matched = line.substring(start_pos).match(matcher)
            if (matched && matched.length) {
                return [BLOCK_MATCHERS[i][1], matched[0]];
            }
        }
        return [BLOCK.plaintext, 0];
    }

    



    /**
     * constructor
     */
    function MarkdownParser() {
        this.reset();
    }

    MarkdownParser.prototype.reset = () => {
        this.state = {
            blockquoteLevel: 0,
            insideCodeContainer: false,
            listLevel: 0,
            listType: null,
        }
    }

    /**
     * Parse a Markdown string into HTML.
     * TODO: parser rules/directives
     * 
     * @param {string} raw_markdown Raw markdown to parse into HTML
     * @param {boolean} [addNewlines=false] Unused
     * @return {string} Parsed markdown as classless HTML
     */
    MarkdownParser.prototype.parseMarkdown = (raw_markdown, addNewlines = false) => { 
        if (typeof raw_markdown != 'string' || raw_markdown.trim().length == 0) {
            return '';
        }

        const raw_lines = raw_markdown.split(/\r?\n/);
        const not_a_paragraph = {};
        const parsed_lines = new Array();

        let k = 0;
        while (k < raw_lines.length) {
            let line = raw_lines[k].trimEnd();
            let nest_offset = 0;
            let [block_class, matched] = getBlockInfo(line);
            // At some point at this position, should parse inline-style things like ***bold*** text
            // (allowing them to span multiple lines)


            // For container code blocks, let's also go ahead and handle them manually here.
            // TODO: handle container code blocks within nested lists or higher-level block elems
            if (block_class == BLOCK.code_container_marker) {
                this.state.insideCodeContainer = !this.state.insideCodeContainer;
                if (this.state.insideCodeContainer) {
                    const language = line.substring(3);
                    // TODO: class format here should be a rule later
                    parsed_lines.push('<pre' + (isEmpty(language) ? '>' : ' class="lang-' + language + '">'));
                } else {
                    parsed_lines.push('</pre>');
                }
                k++;
                continue;
            } else if (this.state.insideCodeContainer) {
                parsed_lines.push(/* ''.repeat(this.state.listLevel * 2) + */ escapeHTMLChars(raw_lines[k]) + '\n');
                not_a_paragraph[parsed_lines.length - 1] = true;
                k++;
                continue;
            }

            // For blockquotes, we can just handle them outside of the BLOCK_MATCHERS
            // this will likely be easier since they (may) span multiple lines and
            // may be nested, which in HTML is not notated on a per-line basis
            if (block_class == BLOCK.blockquote) {
                const depth_diff = matched.trim().length - this.state.blockquoteLevel;
                if (depth_diff != 0) {
                    const tag = '<' + (depth_diff < 0 ? '/' : '') + 'blockquote>';
                    parsed_lines.push(tag.repeat(Math.abs(depth_diff)));
                    this.state.blockquoteLevel = this.state.blockquoteLevel + depth_diff;
                }
                // Reparse the rest of the line
                nest_offset = matched.length;
                [block_class, matched] = getBlockInfo(line, nest_offset);
            } else if (this.state.blockquoteLevel > 0) {
                parsed_lines.push('</blockquote>'.repeat(this.state.blockquoteLevel));
            }
            
            // Some parse functions (cough cough setext headings) might need to manipulate previous parsed_lines
            // instead of returning new ones
            const result = block_class.parse(raw_lines, k, nest_offset, parsed_lines, matched);
            if (typeof result == 'object') {
                parsed_lines.push(result[0]);
                if (result[1] >= k) {
                    k = result[1] + 1;
                }
            } else {
                k++;
            }
        }

        // Check plain lines and assign them paragraph tags.
        // At this point, lines that could have possibly been modified by setext/post stuff have
        // already been handled
        // Also do inline elements here (strong, underline, etc)
        for (let i = 0; i < parsed_lines.length; i++) {
            if (!not_a_paragraph[i] && parsed_lines[i].indexOf('<') == -1) {
                parsed_lines[i] = wrapWithTag('p', parsed_lines[i]);
            }
            for (const k of INLINE) {
                // TODO suboptimal packing logic
                const matches = [...parsed_lines[i].matchAll(k.matcher)]
                if (matches.length > 0) {
                    for (const match of matches) {
                        parsed_lines[i] = (parsed_lines[i] + '').replace(match[0], wrapWithTag(k.tag, match[1]))
                    }
                }
            }

        }

        if (this.state.blockquoteLevel > 0) {
            parsed_lines.push('</blockquote>'.repeat(this.state.blockquoteLevel));
        }
        return parsed_lines.join('');
    }

    return MarkdownParser;
})();

const PdfEditText = (() => {
  function bounds(items) {
    return items.reduce(([x0, y0, x1, y1], { box }) =>
      [Math.min(x0, box[0]), Math.min(y0, box[1]), Math.max(x1, box[2]), Math.max(y1, box[3])],
    [Infinity, Infinity, -Infinity, -Infinity]);
  }

  function nativeRegions(objects, viewport) {
    const fragments = objects.filter((object) => object.type === 1 && !object.hidden)
      .map((object) => ({
        ...object,
        baseline: object.origin ? viewport.convertToViewportPoint(...object.origin)[1] : object.box[3],
        size: object.size || Math.max(1, object.box[3] - object.box[1]) / 0.75,
      }));
    const rows = [];
    for (const fragment of fragments.slice().sort((a, b) => a.baseline - b.baseline || a.box[0] - b.box[0])) {
      const row = rows.at(-1);
      if (row && Math.abs(row.baseline - fragment.baseline) <= Math.max(1, Math.min(row.size, fragment.size) * 0.22)) {
        row.fragments.push(fragment);
      } else {
        rows.push({ baseline: fragment.baseline, size: fragment.size, fragments: [fragment] });
      }
    }

    const lines = [];
    for (const row of rows) {
      let pieces = [];
      let text = "";
      function flush() {
        if (pieces.length) {
          lines.push({ text, pieces, box: bounds(pieces), baseline: row.baseline, size: pieces[0].size, font: pieces[0].font });
        }
        pieces = [];
        text = "";
      }
      for (const piece of row.fragments.sort((a, b) => a.box[0] - b.box[0])) {
        const previous = pieces.at(-1);
        const gap = previous ? piece.box[0] - previous.box[2] : 0;
        if (previous && gap > Math.max(previous.size, piece.size) * 1.8) flush();
        if (text && !/\s$/.test(text) && !/^\s/.test(piece.text) && gap > Math.min(previous.size, piece.size) * 0.22) text += " ";
        pieces.push(piece);
        text += piece.text;
      }
      flush();
    }

    const paragraphs = [];
    for (const line of lines) {
      let paragraph;
      for (let i = paragraphs.length - 1; i >= 0; i--) {
        const candidate = paragraphs[i];
        const previous = candidate.at(-1);
        const distance = line.baseline - previous.baseline;
        if (distance <= 0 || distance > Math.max(previous.size, line.size) * 1.75) continue;
        const overlap = Math.min(previous.box[2], line.box[2]) - Math.max(previous.box[0], line.box[0]);
        const left = Math.min(candidate[0].box[0], previous.box[0]);
        const indented = line.box[0] - previous.box[0] > line.size * 0.65;
        if (overlap > 0 && !indented && Math.abs(left - line.box[0]) < line.size * 1.5
            && previous.font === line.font && Math.abs(previous.size - line.size) < line.size * 0.2) {
          paragraph = candidate;
          break;
        }
      }
      if (paragraph) paragraph.push(line);
      else paragraphs.push([line]);
    }

    const blocks = (groups) => groups.map((group) => ({
      box: bounds(group),
      text: group.map((line) => line.text.trim()).join(" "),
      lines: group,
      ids: group.flatMap((line) => line.pieces.map(({ id }) => id)),
    }));
    return { word: fragments, line: blocks(lines.map((line) => [line])), paragraph: blocks(paragraphs) };
  }

  function layout(text, { box, baseline, advance, size, font }, viewport) {
    if (!text.trim()) return [];
    const ctx = document.createElement("canvas").getContext("2d");
    const fontStyle = /italic|oblique/i.test(font) ? "italic " : "";
    const weight = /bold/i.test(font) ? "bold " : "";
    const family = /times/i.test(font) ? "serif" : /courier/i.test(font) ? "monospace" : "sans-serif";
    const [left, top, right, bottom] = box;
    const availableWidth = right - left;
    const availableHeight = Math.max(size, bottom - top);
    const paragraphs = text.split(/\r?\n/).map((line) => line.trim().split(/\s+/));
    function wrap(fontSize) {
      ctx.font = fontStyle + weight + fontSize + "px " + family;
      return paragraphs.flatMap((words) => {
        const lines = [];
        let line = "";
        for (const word of words) {
          const next = line ? line + " " + word : word;
          if (line && ctx.measureText(next).width > availableWidth) {
            lines.push(line);
            line = word;
          } else {
            line = next;
          }
        }
        lines.push(line);
        return lines;
      });
    }

    let fontSize = size;
    let lines = wrap(fontSize);
    const spacing = Math.max(size, advance);
    for (let attempt = 0; attempt < 16 && (lines.length - 1) * spacing * fontSize / size + fontSize > availableHeight + size * 0.15; attempt++) {
      fontSize *= 0.88;
      lines = wrap(fontSize);
    }
    const lineGap = Math.min(spacing * fontSize / size, (availableHeight - fontSize) / Math.max(1, lines.length - 1));
    const firstBaseline = Math.min(baseline, top + fontSize);
    const pdf = (x, y) => viewport.convertToPdfPoint(x, y);
    const base = pdf(left, firstBaseline);
    const end = pdf(right, firstBaseline);
    const width = Math.hypot(end[0] - base[0], end[1] - base[1]);
    const direction = [(end[0] - base[0]) / width, (end[1] - base[1]) / width];
    const lower = pdf(left, firstBaseline + fontSize);
    const pdfSize = Math.hypot(lower[0] - base[0], lower[1] - base[1]);
    return lines.flatMap((line, index) => line ? [{
      text: line, size: pdfSize, width, direction, baseline: pdf(left, firstBaseline + index * lineGap),
    }] : []);
  }

  return { nativeRegions, layout };
})();

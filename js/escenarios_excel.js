/* Exportación nativa de Excel: dos hojas legibles, sin dependencias externas.
   Genera un .xlsx OOXML/ZIP real. No utiliza CDN ni CSV con extensión XLSX. */
(function () {
  'use strict';
  const encoder = new TextEncoder();
  const bytes = v => encoder.encode(v);
  const xmlEsc = v => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
  const col = index => {
    let s = '', n = index + 1;
    while (n) { n--; s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26); }
    return s;
  };
  // Tabla de cadenas compartidas: Excel para Windows maneja esta forma OOXML
  // de manera más consistente que celdas inlineString en libros grandes.
  const strings = new Map();
  const sharedValues = [];
  const stringIndex = value => {
    const s = String(value ?? '');
    if (!strings.has(s)) { strings.set(s, sharedValues.length); sharedValues.push(s); }
    return strings.get(s);
  };
  const sharedXml = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedValues.length}" uniqueCount="${sharedValues.length}">${sharedValues.map(v=>`<si><t xml:space="preserve">${xmlEsc(v)}</t></si>`).join('')}</sst>`;
  const cell = (r, c, value, style = 0) => {
    const name = `${col(c)}${r}`;
    const styleAttr = style ? ` s="${style}"` : '';
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${name}"${styleAttr}><v>${value}</v></c>`;
    return `<c r="${name}" t="s"${styleAttr}><v>${stringIndex(value)}</v></c>`;
  };
  const row = (n, cells, h = 26) => `<row r="${n}" ht="${h}" customHeight="1">${cells.join('')}</row>`;
  const merge = refs => `<mergeCells count="${refs.length}">${refs.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`;
  const cols = widths => `<cols>${widths.map((w, i) => `<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols>`;
  const views = (x = 0, y = 0) => `<sheetViews><sheetView workbookViewId="0" showGridLines="0">${x||y ? `<pane xSplit="${x}" ySplit="${y}" topLeftCell="${col(x)}${y+1}" activePane="bottomRight" state="frozen"/>` : ''}</sheetView></sheetViews>`;
  const worksheet = (dimensions, view, columnSpecs, data, merged, extra = '') => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <dimension ref="${dimensions}"/>${view}<sheetFormatPr defaultRowHeight="21"/>
    ${cols(columnSpecs)}<sheetData>${data.join('')}</sheetData>${merged.length?merge(merged):''}${extra}
    <pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
    <pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>
    </worksheet>`;

  // 164 = formato numérico monetario: conserva cifras completas y es operable en Excel.
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;S/ &quot;#,##0.00;[Red](&quot;S/ &quot;#,##0.00)"/></numFmts>
    <fonts count="4">
      <font><sz val="10"/><name val="Aptos"/><color rgb="FF2B4659"/></font>
      <font><b/><sz val="16"/><name val="Aptos Display"/><color rgb="FFFFFFFF"/></font>
      <font><b/><sz val="10"/><name val="Aptos"/><color rgb="FF28485E"/></font>
      <font><b/><sz val="10"/><name val="Aptos"/><color rgb="FFFFFFFF"/></font>
    </fonts>
    <fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
      <fill><patternFill patternType="solid"><fgColor rgb="FF871B35"/><bgColor indexed="64"/></patternFill></fill>
      <fill><patternFill patternType="solid"><fgColor rgb="FFEAF1F5"/><bgColor indexed="64"/></patternFill></fill>
      <fill><patternFill patternType="solid"><fgColor rgb="FFF7F9FB"/><bgColor indexed="64"/></patternFill></fill></fills>
    <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
      <border><left/><right/><top/><bottom style="thin"><color rgb="FFE0E8EE"/></bottom><diagonal/></border></borders>
    <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
    <cellXfs count="10">
      <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
      <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
      <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1"/>
      <xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
      <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
      <xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
      <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/>
      <xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/>
      <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
      <xf numFmtId="164" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1"/>
    </cellXfs>
    <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  </styleSheet>`;

  function summarySheet(config) {
    const data = [], merged = ['A1:I1', 'A2:I2', 'A4:I4'];
    data.push(row(1, [cell(1, 0, 'LEY N.° 32416  |  ALTERNATIVAS DE ATENCIÓN', 1)], 36));
    data.push(row(2, [cell(2, 0, 'RESUMEN DE CRITERIOS Y RESULTADOS DEL ESCENARIO', 2)], 27));
    data.push(row(4, [cell(4, 0, 'CRITERIOS APLICADOS', 2)], 27));
    config.criteria.forEach(([label, value], i) => {
      const n = i + 5;
      merged.push(`A${n}:C${n}`, `D${n}:I${n}`);
      const h = String(value).length > 90 ? 40 : String(value).length > 65 ? 34 : 27;
      data.push(row(n, [cell(n, 0, label, 3), cell(n, 3, value, 4)], h));
    });
    const footerRow = config.criteria.length + 7;
    merged.push(`A${footerRow}:I${footerRow}`);
    data.push(row(footerRow, [cell(footerRow, 0, 'COMPARACIÓN DE ALTERNATIVAS', 2)], 28));
    const headers=['Alternativa','IOARR','Pliegos','Provincias','Puentes','IOARR El Niño','Brecha asignada (S/)','Brecha/IOARR (S/)','Saldo presupuesto (S/)'];
    data.push(row(footerRow+1,headers.map((t,i)=>cell(footerRow+1,i,t,5)),35));
    (config.comparisons||[]).forEach((item,i)=>{
      const n=footerRow+2+i;
      const vals=[item.label,item.n,item.pliegos,item.provincias,item.bridges,item.emergencies||0,item.spent,item.n?item.spent/item.n:0,item.budgetRemaining==null?'':item.budgetRemaining];
      data.push(row(n, vals.map((v,k)=>cell(n,k,v,k>=6?6:k>=1?7:4)),28));
    });
    const last = footerRow + 2 + (config.comparisons||[]).length;
    return worksheet(`A1:I${last}`, views(0, 4), [22, 16, 15, 26, 18, 18, 23, 22, 24], data, merged);
  }

  function detailsSheet(config) {
    // Hoja de datos estrictamente tabular: encabezado en FILA 1, datos desde
    // FILA 2. Sin combinaciones de celdas ni paneles horizontales partidos.
    // Se eliminan los elementos decorativos que generaron hojas invisibles
    // o incompatibles con ciertas versiones de Excel de escritorio.
    const headers = config.columns;
    const lastColumn = col(headers.length-1);
    const data = [row(1,headers.map((title,i)=>cell(1,i,title,5)),42)];
    config.records.forEach((record,index)=>{
      const n=index+2, odd=index%2===1;
      const items=record.map((value,c)=>{
        const style=config.moneyColumns.includes(c)?(odd?9:6):config.integerColumns.includes(c)?7:odd?8:4;
        return cell(n,c,value==null?'':value,style);
      });
      data.push(row(n,items,24));
    });
    const lastRow=Math.max(2,config.records.length+1);
    const widths=[14,18,21,21,37,11,21,21,21,21,16,15,45,20,13,16];
    const plainViews = '<sheetViews><sheetView workbookViewId="0" tabSelected="1" showGridLines="0" topLeftCell="A1"/></sheetViews>';
    return worksheet(`A1:${lastColumn}${lastRow}`,plainViews,widths,data,[],
      `<autoFilter ref="A1:${lastColumn}${lastRow}"/>`);
  }

  function auditSheet(config) {
    const headers=config.auditColumns||[];
    const records=config.auditRecords||[];
    const lastColumn=col(headers.length-1);
    const data=[row(1,headers.map((x,i)=>cell(1,i,x,5)),36)];
    records.forEach((rec,i)=>{
      const nr=i+2;
      data.push(row(nr,rec.map((v,k)=>cell(nr,k,v,k===5?6:i%2?8:4)),25));
    });
    const lastRow=Math.max(2,records.length+1);
    const v='<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>';
    return worksheet(`A1:${lastColumn}${lastRow}`,v,[14,38,18,20,20,24,65],data,[],`<autoFilter ref="A1:${lastColumn}${lastRow}"/>`);
  }

  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let v = i; for (let j = 0; j < 8; j++) v = v & 1 ? (0xEDB88320 ^ (v >>> 1)) : v >>> 1;
    crcTable[i] = v >>> 0;
  }
  function crc32(data) {
    let crc = 0xFFFFFFFF;
    for (const b of data) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function writeZip(entries) {
    const chunks = [], centralChunks = [];
    let offset = 0;
    for (const [path, value] of entries) {
      const name = bytes(path), data = bytes(value), crc = crc32(data);
      const local = new Uint8Array(30 + name.length), l = new DataView(local.buffer);
      l.setUint32(0, 0x04034B50, true); l.setUint16(4, 20, true);
      l.setUint32(14, crc, true); l.setUint32(18, data.length, true); l.setUint32(22, data.length, true);
      l.setUint16(26, name.length, true); local.set(name, 30);
      chunks.push(local, data);
      const central = new Uint8Array(46 + name.length), c = new DataView(central.buffer);
      c.setUint32(0, 0x02014B50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, offset, true); central.set(name, 46);
      centralChunks.push(central);
      offset += local.length + data.length;
    }
    const dirSize = centralChunks.reduce((a, c) => a + c.length, 0);
    const end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054B50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true);
    e.setUint32(12, dirSize, true); e.setUint32(16, offset, true);
    return new Blob([...chunks, ...centralChunks, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function build(config) {
    strings.clear();sharedValues.length=0;
    const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
      <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
    </Types>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    const book = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <bookViews><workbookView activeTab="1"/></bookViews><sheets>
      <sheet name="Resumen del escenario" sheetId="1" r:id="rId1"/>
      <sheet name="Detalle de inversiones" sheetId="2" r:id="rId2"/>
      <sheet name="CUI no seleccionados" sheetId="3" r:id="rId4"/></sheets></workbook>`;
    const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
      <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
      <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
      <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
    const sheets=[summarySheet(config),detailsSheet(config),auditSheet(config)];
    return writeZip([
      ['[Content_Types].xml', types], ['_rels/.rels', rels],
      ['xl/workbook.xml', book], ['xl/_rels/workbook.xml.rels', workbookRels], ['xl/styles.xml', styles],['xl/sharedStrings.xml',sharedXml()],
      ['xl/worksheets/sheet1.xml', sheets[0]], ['xl/worksheets/sheet2.xml', sheets[1]], ['xl/worksheets/sheet3.xml', sheets[2]]
    ]);
  }
  function buildDetailOnly(config) {
    strings.clear();sharedValues.length=0;
    const oneSheet=detailsSheet(config);
    const types=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
      <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
    </Types>`;
    const rels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    const book=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Detalle de inversiones" sheetId="1" r:id="rId1"/></sheets></workbook>`;
    const links=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
      <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
    return writeZip([['[Content_Types].xml',types],['_rels/.rels',rels],['xl/workbook.xml',book],['xl/_rels/workbook.xml.rels',links],['xl/styles.xml',styles],['xl/sharedStrings.xml',sharedXml()],['xl/worksheets/sheet1.xml',oneSheet]]);
  }
  function download(config,detailOnly=false) {
    const blob = detailOnly ? buildDetailOnly(config) : build(config);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url;
    link.download = config.filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  window.ESCExcel = { download, build, buildDetailOnly };
})();

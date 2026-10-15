/** Spreadsheet presentation only. Go remains the reporting and aggregation source. */
const REPORT_TABS = [
  'Overview', 'Traffic Sources', 'Content Performance', 'Returning Visitors',
  'Engagement', 'Conversions', 'Collector Health', 'Daily', 'Hourly'
];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Ben Davis Builds')
    .addItem('Format reports', 'formatReports')
    .addSeparator()
    .addItem('Show latest sync', 'showLatestSync')
    .addToUi();
}

function formatReports() {
  const ss = SpreadsheetApp.getActive();
  REPORT_TABS.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 1) return;
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, sheet.getLastColumn())
      .setFontWeight('bold').setWrap(true);
    sheet.autoResizeColumns(1, Math.min(sheet.getLastColumn(), 8));
  });
  addOverviewChart_(ss);
}

function showLatestSync() {
  const sheet = SpreadsheetApp.getActive().getSheetByName('Overview');
  if (!sheet) throw new Error('Overview tab is missing. Run the Go exporter first.');
  const values = sheet.getRange(1, 1, sheet.getLastRow(), Math.min(3, sheet.getLastColumn())).getDisplayValues();
  const row = values.find(r => r[0] === 'Visitors today');
  SpreadsheetApp.getUi().alert('Latest report sync (UTC): ' + (row && row[2] || 'not available'));
}

function addOverviewChart_(ss) {
  const sheet = ss.getSheetByName('Daily');
  if (!sheet || sheet.getLastRow() < 2) return;
  sheet.getCharts().forEach(chart => sheet.removeChart(chart));
  const chart = sheet.newChart().setChartType(Charts.ChartType.LINE)
    .addRange(sheet.getRange(1, 1, sheet.getLastRow(), Math.min(3, sheet.getLastColumn())))
    .setPosition(2, 5, 0, 0).setOption('title', 'Daily events (UTC)')
    .setOption('legend', { position: 'bottom' }).build();
  sheet.insertChart(chart);
}

/** Optional weekly summary. Disabled unless WEEKLY_SUMMARY_TO is set in script properties. */
function sendWeeklySummary() {
  const to = PropertiesService.getScriptProperties().getProperty('WEEKLY_SUMMARY_TO');
  if (!to) return;
  const sheet = SpreadsheetApp.getActive().getSheetByName('Overview');
  if (!sheet) return;
  const body = sheet.getRange(1, 1, sheet.getLastRow(), Math.min(3, sheet.getLastColumn()))
    .getDisplayValues().map(row => row.join(' | ')).join('\n');
  MailApp.sendEmail(to, 'Ben Davis Builds weekly analytics summary', body);
}

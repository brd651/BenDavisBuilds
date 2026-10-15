import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('./Code.gs',import.meta.url),'utf8');
function harness(){
 const sent=[],items=[],alerts=[],formatted=[],charts=[];let recipient=null;
 const range={setFontWeight(){return this},setWrap(){return this},getDisplayValues(){return [['Metric','Value','As of UTC'],['Visitors today','0','2026-10-14T00:00:00Z']]}};
 const chart={setChartType(){return this},addRange(){return this},setPosition(){return this},setOption(){return this},build(){return this}};
 const sheets=new Map(['Overview','Daily'].map(name=>[name,{getLastRow:()=>2,getLastColumn:()=>3,setFrozenRows:n=>formatted.push([name,n]),getRange:()=>range,autoResizeColumns(){},getCharts:()=>charts,removeChart:c=>charts.splice(charts.indexOf(c),1),newChart:()=>chart,insertChart:c=>charts.push(c)}]));
 const menu={addItem(label,handler){items.push([label,handler]);return this},addSeparator(){return this},addToUi(){return this}};
 const context=vm.createContext({SpreadsheetApp:{getActive:()=>({getSheetByName:n=>sheets.get(n)}),getUi:()=>({createMenu:()=>menu,alert:m=>alerts.push(m)})},Charts:{ChartType:{LINE:'line'}},PropertiesService:{getScriptProperties:()=>({getProperty:()=>recipient})},MailApp:{sendEmail:(...args)=>sent.push(args)}});
 vm.runInContext(code,context);return {context,sent,items,alerts,formatted,charts,setRecipient:v=>recipient=v};
}
test('menu, chart formatting and latest sync presentation use exported tables',()=>{const h=harness();h.context.onOpen();assert.equal(h.items.length,2);h.context.formatReports();assert.equal(h.formatted.length,2);assert.equal(h.charts.length,1);h.context.formatReports();assert.equal(h.charts.length,1);h.context.showLatestSync();assert.match(h.alerts[0],/2026-10-14T00:00:00Z/)});
test('weekly email is opt-in and has no automatic trigger or ingest webhook',()=>{const h=harness();h.context.sendWeeklySummary();assert.equal(h.sent.length,0);h.setRecipient('owner@example.test');h.context.sendWeeklySummary();assert.equal(h.sent.length,1);assert.match(h.sent[0][2],/Visitors today/);assert.doesNotMatch(code,/doPost|doGet|ScriptApp\.newTrigger/)});
test('default authorization excludes email and external network scopes',()=>{const manifest=JSON.parse(readFileSync(new URL('./appsscript.json',import.meta.url),'utf8'));assert.deepEqual(manifest.oauthScopes,['https://www.googleapis.com/auth/spreadsheets.currentonly'])});

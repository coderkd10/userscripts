// ==UserScript==
// @name         Airflow log download
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Add a download button in the airflow logs page to make debugging easier
// @author       Abhishek Kedia <kedia.abhishek10@gmail.com>
// @match        http://airflow.blueshift.vpc/admin/airflow/log*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';
  
    // JS to add a log download button in the airflow logs page
    // Corresponding CSS: https://github.com/coderkd10/userscripts/raw/master/airflow/log_download_button/airflow_log_download_button.user.css
  
    function humanFileSize(bytes, si=false, dp=1) {
      const thresh = si ? 1000 : 1024;
  
      if (Math.abs(bytes) < thresh) {
        return bytes + ' B';
      }
  
      const units = si
      ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
      : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
      let u = -1;
      const r = 10**dp;
  
      do {
        bytes /= thresh;
        ++u;
      } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);
  
  
      return bytes.toFixed(dp) + ' ' + units[u];
    }
  
    function formatDate(date) {
      var d = new Date(date),
          month = '' + (d.getMonth() + 1),
          day = '' + d.getDate(),
          year = d.getFullYear();
  
      if (month.length < 2) {
          month = '0' + month;
      }
      if (day.length < 2) {
          day = '0' + day;
      }
  
      return [year, month, day].join('-');
    }
  
    function getLogFileName() {
      var url = new URL(window.location.href)
      var dag = url.searchParams.get("dag_id") || "unknown_dag"
      var task = url.searchParams.get("task_id") || "unknown_task_id"
      var execution_date = Date.parse(url.searchParams.get("execution_date"))
      if (isNaN(execution_date)) {
        execution_date = "unknown_date"
      } else {
        execution_date = formatDate(execution_date)
      }
      var fileName = `${dag}--${task}--${execution_date}.log.txt`
      console.log("log filename : ", fileName)
      return fileName
    }
  
    function triggerDownloadLog() {
      console.log("download btn clicked. triggering download ...")
      var logDiv = document.querySelector(".container > pre")
      var blob = new Blob([logDiv.innerText], {type: "text/plain"})
      var url = window.URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.download = getLogFileName();
      a.href = window.URL.createObjectURL(blob);
      a.click();
      window.URL.revokeObjectURL(url);
    }
  
    function setupLogDownloadBtn() {
      var $ = window.jQuery
      var logDiv = document.querySelector(".container > pre")
      var logSizBytes = logDiv.innerText.length
      var btn = document.querySelector(".container > h4:nth-of-type(2)")
      btn.addEventListener("click", triggerDownloadLog)
      btn.innerText = `Download Log [ ${humanFileSize(logSizBytes, true)} ]`
      $(btn).addClass("log_download_btn")
    }
  
    if (document.readyState == 'loading') {
      console.log("not yet fully loaded")
      document.addEventListener('readystatechange', setupLogDownloadBtn)
    } else {
      console.log(`not in loading state. state = ${document.readyState}`)
      setupLogDownloadBtn()
    }
  
  })();

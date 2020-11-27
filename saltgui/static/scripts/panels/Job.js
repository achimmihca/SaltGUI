/* global config document window */

import {DropDownMenu} from "../DropDown.js";
import {Output} from "../output/Output.js";
import {Panel} from "./Panel.js";
import {ParseCommandLine} from "../ParseCommandLine.js";
import {TargetType} from "../TargetType.js";
import {Utils} from "../Utils.js";

export class JobPanel extends Panel {

  constructor () {
    super("job");

    this.addTitle("... on ...");
    this.addCloseButton();
    this.addPanelMenu();
    this.addSearchButton();

    const time = document.createElement("h2");
    time.classList.add("time");
    this.div.append(time);
    this.timeField = time;

    const output = document.createElement("pre");
    output.id = "job-table";
    output.classList.add("output");
    this.output = output;

    const searchBox = Utils.makeSearchBox(this.searchButton, this.output, "data-list-job");
    this.div.appendChild(searchBox);

    this.div.append(this.output);
  }

  onShow () {
    const jobId = decodeURIComponent(Utils.getQueryParam("id"));

    JobPanel.jobIsTerminated = undefined;

    const runnerJobsListJobPromise = this.api.getRunnerJobsListJob(jobId);
    const runnerJobsActivePromise = this.api.getRunnerJobsActive();

    runnerJobsListJobPromise.then((pRunnerJobsListJobData) => {
      this._handleJobRunnerJobsListJob(pRunnerJobsListJobData, jobId);
      runnerJobsActivePromise.then((pRunnerJobsActiveData) => {
        this._handleRunnerJobsActive(jobId, pRunnerJobsActiveData);
        return true;
      }, (pRunnerJobsActiveMsg) => {
        this._handleRunnerJobsActive(jobId, JSON.stringify(pRunnerJobsActiveMsg));
        return false;
      });
      return true;
    }, (pRunnerJobsListJobsMsg) => {
      this._handleJobRunnerJobsListJob(JSON.stringify(pRunnerJobsListJobsMsg), jobId);
      return true;
    });
  }

  static _isResultOk (result) {
    if (!result.success) {
      return false;
    }
    if (result.retcode !== 0) {
      return false;
    }
    return true;
  }

  static decodeArgumentsText (rawArguments) {

    if (rawArguments === undefined) {
      // no arguments
      return "";
    }

    if (typeof rawArguments !== "object") {
      // expecting an array (which is an object)
      // just return the representation of anything else
      return " " + JSON.stringify(rawArguments);
    }

    if (!Array.isArray(rawArguments)) {
      // expecting an array
      // just return the representation of anything else
      return " " + JSON.stringify(rawArguments);
    }

    let ret = "";
    for (const obj of rawArguments) {
      // all KWARGS are one entry in the parameters array
      if (obj && typeof obj === "object" && "__kwarg__" in obj) {
        const keys = Object.keys(obj).sort();
        for (const key of keys) {
          if (key === "__kwarg__") {
            continue;
          }
          ret += " " + key + "=" + Output.formatObject(obj[key]);
        }
      } else if (typeof obj === "string" &&
                ParseCommandLine.getPatJid().test(obj)) {
        // prevent quotes being added on JIDs
        ret += " " + obj;
      } else {
        const objAsString = JSON.stringify(obj);
        ret += " " + objAsString;
      }
    }

    return ret;
  }

  static _getPatEmbeddedJid () {
    return /\b[2-9][0-9][0-9][0-9][01][0-9][0-3][0-9][0-2][0-9][0-5][0-9][0-5][0-9][0-9][0-9][0-9][0-9][0-9][0-9]\b/g;
  }

  _handleJobRunnerJobsListJob (pRunnerJobsListJobData, pJobId) {
    if (!pRunnerJobsListJobData) {
      return;
    }

    if (typeof pRunnerJobsListJobData !== "object") {
      this.output.innerText = "";
      Utils.addErrorToTableCell(this.output, pRunnerJobsListJobData);
      this.updateTitle("ERROR");
      return;
    }

    const info = pRunnerJobsListJobData.return[0];

    if (info.Error) {
      this.updateTitle("ERROR");
      this.output.innerText = info.Error + " (" + pJobId + ")";
      this.timeField.innerText = Output.dateTimeStr(info.StartTime);
      return;
    }

    this.output.innerText = "";

    // use same formatter as direct commands
    const argumentsText = JobPanel.decodeArgumentsText(info.Arguments);
    const commandText = info.Function + argumentsText;

    // 1: re-run with original target pattern
    this._addMenuItemJobRerunJob(info, commandText);

    // 2: re-run list of minions
    this._addMenuItemRerunJobOnAllMinionsWhenNeeded(info, commandText);

    // 3: re-run all failed (error+timeout)
    this._addMenuItemRerunJobOnUnsuccessfulMinionsWhenNeeded(info, commandText);

    // 4: re-run all failed (error)
    this._addMenuItemRerunJobOnFailedMinionsWhenNeeded(info, commandText);

    // 5: re-run all failed (timeout)
    this._addMenuItemRerunJobOnNonRespondingMinionsWhenNeeded(info, commandText);

    // 6: kill with original target pattern
    this._addMenuItemTerminateJob(info, pJobId);
    this._addMenuItemKillJob(info, pJobId);
    this._addMenuItemSignalJob(info, pJobId);

    const functionText = commandText + " on " +
      TargetType.makeTargetText(info);
    this.updateTitle(functionText);

    this.timeField.innerText = Output.dateTimeStr(info.StartTime);

    let minions = ["WHEEL"];
    if (info.Minions) {
      minions = info.Minions;
    }
    let initialStatus;
    if (info.Minions === undefined || Object.keys(info.Result).length >= info.Minions.length) {
      // we have all the results
      // that means we are done
      // don't wait for RunnerJobsActive to also tell us that we are done
      // RunnerJobsActive remains running and will overwrite with the same
      initialStatus = "done";
      this.jobIsTerminated = true;
    } else {
      initialStatus = "(loading)";
      this.jobIsTerminated = false;
    }
    Output.addResponseOutput(this.output, pJobId, minions, info.Result, info.Function, initialStatus);

    // replace any jobid
    // Don't do this with output.innerHTML as there are already
    // event handlers in place, which then will be removed
    const patJid = JobPanel._getPatEmbeddedJid();
    const elements = this.output.querySelectorAll(".minion-output");
    for (const element of elements) {
      let html = element.innerHTML;
      html = html.replace(patJid, "<a class='linkjid' id='linkjid$&'>$&</a>");
      element.innerHTML = html;
    }

    const links = this.output.querySelectorAll(".linkjid");
    for (const link of links) {
      const linkToJid = link.id.replace("linkjid", "");

      if (linkToJid === pJobId) {
        link.classList.add("disabled");
        Utils.addToolTip(link, "this job");
      } else {
        link.addEventListener("click", () => {
          window.location.assign(config.NAV_URL + "/job?id=" + linkToJid);
        });
      }

      // no longer needed
      link.removeAttribute("id");
      link.classList.remove("linkjid");
      if (!link.classList.length) {
        link.removeAttribute("class");
      }
    }
  }

  _addMenuItemJobRerunJob (info, commandText) {
    this.panelMenu.addMenuItem("Re-run job...", (pClickEvent) => {
      this.runFullCommand(pClickEvent, info["Target-type"], info.Target, commandText);
    });
  }

  _addMenuItemRerunJobOnAllMinionsWhenNeeded (info, commandText) {
    if (!info.Minions) {
      return;
    }

    let minionList = "";
    for (const minionId of info.Minions) {
      minionList += "," + minionId;
    }

    // suppress an empty list
    if (!minionList) {
      return;
    }

    // suppress a trivial case
    if (minionList === "," + info.Minions[0]) {
      return;
    }

    const lst = minionList.substring(1);
    this.panelMenu.addMenuItem("Re-run job on all minions...", (pClickEvent) => {
      this.runFullCommand(pClickEvent, "list", lst, commandText);
    });
  }

  _addMenuItemRerunJobOnUnsuccessfulMinionsWhenNeeded (info, commandText) {
    if (!info.Minions) {
      return;
    }

    let minionList = "";
    let has1 = false;
    let has2 = false;
    for (const minionId of info.Minions) {
      if (!(minionId in info.Result)) {
        has1 = true;
      }
      if (minionId in info.Result && !JobPanel._isResultOk(info.Result[minionId])) {
        has2 = true;
      }
      if (!(minionId in info.Result) || !JobPanel._isResultOk(info.Result[minionId])) {
        minionList += "," + minionId;
      }
    }

    // suppress an empty list
    if (!minionList) {
      return;
    }

    // only when we have both types in the list
    // otherwise the #4 or #5 is sufficient
    if (!has1 || !has2) {
      return;
    }

    const lst = minionList.substring(1);
    this.panelMenu.addMenuItem("Re-run job on unsuccessful minions...", (pClickEvent) => {
      this.runFullCommand(pClickEvent, "list", lst, commandText);
    });
  }

  _addMenuItemRerunJobOnFailedMinionsWhenNeeded (info, commandText) {
    if (!info.Minions) {
      return;
    }

    let minionList = "";
    for (const minionId of info.Minions) {
      if (minionId in info.Result && !JobPanel._isResultOk(info.Result[minionId])) {
        minionList += "," + minionId;
      }
    }

    // suppress an empty list
    if (!minionList) {
      return;
    }

    const lst = minionList.substring(1);
    this.panelMenu.addMenuItem("Re-run job on failed minions...", (pClickEvent) => {
      this.runFullCommand(pClickEvent, "list", lst, commandText);
    });
  }

  _addMenuItemRerunJobOnNonRespondingMinionsWhenNeeded (info, commandText) {
    if (!info.Minions) {
      return;
    }

    let minionList = "";
    for (const minionId of info.Minions) {
      if (!(minionId in info.Result)) {
        minionList += "," + minionId;
      }
    }

    // suppress an empty list
    if (!minionList) {
      return;
    }

    const lst = minionList.substring(1);
    this.panelMenu.addMenuItem("Re-run job on non responding minions...", (pClickEvent) => {
      this.runFullCommand(pClickEvent, "list", lst, commandText);
    });
  }

  _addMenuItemTerminateJob (info, pJobId) {
    this.panelMenu.addMenuItem(
      /* eslint-disable no-extra-parens */
      () => (JobPanel.jobIsTerminated === false ? "Terminate job..." : null),
      /* eslint-enable no-extra-parens */
      (pClickEvent) => {
        this.runFullCommand(pClickEvent, info["Target-type"], info.Target, "saltutil.term_job " + pJobId);
      }
    );
  }

  _addMenuItemKillJob (info, pJobId) {
    this.panelMenu.addMenuItem(
      /* eslint-disable no-extra-parens */
      () => (JobPanel.jobIsTerminated === false ? "Kill job..." : null),
      /* eslint-enable no-extra-parens */
      (pClickEvent) => {
        this.runFullCommand(pClickEvent, info["Target-type"], info.Target, "saltutil.kill_job " + pJobId);
      }
    );
  }

  _addMenuItemSignalJob (info, pJobId) {
    this.panelMenu.addMenuItem(
      /* eslint-disable no-extra-parens */
      () => (JobPanel.jobIsTerminated === false ? "Signal job..." : null),
      /* eslint-enable no-extra-parens */
      (pClickEvent) => {
        this.runFullCommand(pClickEvent, info["Target-type"], info.Target, "saltutil.signal_job " + pJobId + " signal=<signalnumber>");
      }
    );
  }

  _handleRunnerJobsActive (pJobId, pData) {
    const summaryJobsActiveSpan = document.getElementById("summary-jobs-active");
    if (!summaryJobsActiveSpan) {
      return;
    }

    if (typeof pData !== "object") {
      summaryJobsActiveSpan.innerText = "(error)";
      Utils.addToolTip(summaryJobsActiveSpan, pData, "bottom-left");
      return;
    }

    const info = pData.return[0][pJobId];

    // when the job is already completely done, nothing is returned
    if (!info) {
      summaryJobsActiveSpan.innerText = "done";
      JobPanel.jobIsTerminated = true;
      return;
    }
    JobPanel.jobIsTerminated = false;

    summaryJobsActiveSpan.innerText = info.Running.length + " active";
    summaryJobsActiveSpan.insertBefore(Utils.createJobStatusSpan(pJobId), summaryJobsActiveSpan.firstChild);
    summaryJobsActiveSpan.addEventListener("click", () => {
      window.location.reload();
    });
    summaryJobsActiveSpan.style.cursor = "pointer";
    Utils.addToolTip(summaryJobsActiveSpan, "Click to refresh", "bottom-left");

    // update the minion details
    for (const minionInfo of info.Running) {
      // each minionInfo is like {'minion': pid}
      for (const minionId in minionInfo) {
        const pid = minionInfo[minionId];
        const noResponseSpan = this.div.querySelector("pre.output div#" + Utils.getIdFromMinionId(minionId) + " span.noresponse");
        if (!noResponseSpan) {
          continue;
        }

        // show that this minion is still active on the request
        noResponseSpan.innerText = "(active) ";

        const menu = new DropDownMenu(noResponseSpan);
        menu.addMenuItem("Show process info...", (pClickEvent) => {
          this.runFullCommand(pClickEvent, "list", minionId, "ps.proc_info " + pid);
        });
        menu.addMenuItem("Terminate process...", (pClickEvent) => {
          this.runFullCommand(pClickEvent, "list", minionId, "ps.kill_pid " + pid + " signal=15");
        });
        menu.addMenuItem("Kill process...", (pClickEvent) => {
          this.runFullCommand(pClickEvent, "list", minionId, "ps.kill_pid " + pid + " signal=9");
        });
        menu.addMenuItem("Signal process...", (pClickEvent) => {
          this.runFullCommand(pClickEvent, "list", minionId, "ps.kill_pid " + pid + " signal=<signalnumber>");
        });

        noResponseSpan.classList.remove("noresponse");
        noResponseSpan.classList.add("active");
      }
    }
  }

  handleSaltJobRetEvent (pData) {

    // ignore the most common events until someone complains
    if (pData.fun === "saltutil.find_job") {
      return;
    }
    if (pData.fun === "saltutil.running") {
      return;
    }

    // { fun_args: […], jid: "20190704194624366796", return: true, retcode: 0, success: true, cmd: "_return", fun: "test.rand_sleep", id: "autobuild-it-4092", _stamp: "2019-07-04T17:46:28.448689" }
    const jid = pData.jid;
    if (!jid) {
      return;
    }

    let newLevel = 0;
    if (pData.success === true && pData.retcode === 0) {
      newLevel = 1;
    } else if (pData.success === true) {
      newLevel = 2;
    } else {
      newLevel = 3;
    }

    // This element only exists when the user happens to look at the output of that jobId.
    const span = this.div.querySelector("#status" + jid);
    if (span) {
      let oldLevel = span.dataset.level;
      if (oldLevel === undefined) {
        oldLevel = 0;
      }
      if (newLevel > oldLevel) {
        span.dataset.level = newLevel;
        if (newLevel === 1) {
          span.style.color = "lime";
        } else if (newLevel === 2) {
          span.style.color = "yellow";
        } else if (newLevel === 3) {
          span.style.color = "red";
        }
      }
      span.style.removeProperty("display");
    }
  }
}

import clone from "lodash/clone";
import orderBy from "lodash/orderBy";
import set from "lodash/set";
import unset from "lodash/unset";
import update from "lodash/update";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
import {
  TWorkspaceDraftIssue,
  TWorkspaceDraftPaginationInfo,
  TWorkspaceDraftIssueLoader,
  TWorkspaceDraftQueryParams,
  TPaginationData,
  TLoader,
  TGroupedIssues,
  TSubGroupedIssues,
  ViewFlags,
  TIssue,
} from "@plane/types";
// constants
import { EDraftIssuePaginationType } from "@/constants/workspace-drafts";
// helpers
import { getCurrentDateTimeInISO, convertToISODateString } from "@/helpers/date-time.helper";
// services
import workspaceDraftService from "@/services/issue/workspace_draft.service";

export type TDraftIssuePaginationType = EDraftIssuePaginationType;

export interface IWorkspaceDraftIssues {
  // observables
  issuesMap: Record<string, TWorkspaceDraftIssue>;
  paginationInfo: Omit<TWorkspaceDraftPaginationInfo<TWorkspaceDraftIssue>, "results"> | undefined;
  loader: TWorkspaceDraftIssueLoader;
  // computed
  issueIds: string[];
  // computed functions
  getIssueById: (issueId: string) => TWorkspaceDraftIssue | undefined;
  // helper actions
  addIssue: (issues: TWorkspaceDraftIssue[]) => void;
  mutateIssue: (issueId: string, data: Partial<TWorkspaceDraftIssue>) => void;
  removeIssue: (issueId: string) => Promise<void>;
  // actions
  fetchIssues: (
    workspaceSlug: string,
    loadType: TWorkspaceDraftIssueLoader,
    paginationType?: TDraftIssuePaginationType
  ) => Promise<TWorkspaceDraftPaginationInfo<TWorkspaceDraftIssue> | undefined>;
  createIssue: (
    workspaceSlug: string,
    payload: Partial<TWorkspaceDraftIssue | TIssue>
  ) => Promise<TWorkspaceDraftIssue | undefined>;
  updateIssue: (
    workspaceSlug: string,
    issueId: string,
    payload: Partial<TWorkspaceDraftIssue | TIssue>
  ) => Promise<TWorkspaceDraftIssue | undefined>;
  deleteIssue: (workspaceSlug: string, issueId: string) => Promise<void>;
  moveIssue: (workspaceSlug: string, issueId: string, payload: Partial<TWorkspaceDraftIssue>) => Promise<void>;
  addCycleToIssue: (
    workspaceSlug: string,
    issueId: string,
    cycleId: string
  ) => Promise<TWorkspaceDraftIssue | undefined>;
  addModulesToIssue: (
    workspaceSlug: string,
    issueId: string,
    moduleIds: string[]
  ) => Promise<TWorkspaceDraftIssue | undefined>;

  // dummies
  viewFlags: ViewFlags;
  groupedIssueIds: TGroupedIssues | TSubGroupedIssues | undefined;
  getIssueIds: (groupId?: string, subGroupId?: string) => string[] | undefined;
  getPaginationData(groupId: string | undefined, subGroupId: string | undefined): TPaginationData | undefined;
  getIssueLoader(groupId?: string, subGroupId?: string): TLoader;
  getGroupIssueCount: (
    groupId: string | undefined,
    subGroupId: string | undefined,
    isSubGroupCumulative: boolean
  ) => number | undefined;
  removeCycleFromIssue: (workspaceSlug: string, projectId: string, issueId: string) => Promise<void>;
  addIssueToCycle: (
    workspaceSlug: string,
    projectId: string,
    cycleId: string,
    issueIds: string[],
    fetchAddedIssues?: boolean
  ) => Promise<void>;
  removeIssueFromCycle: (workspaceSlug: string, projectId: string, cycleId: string, issueId: string) => Promise<void>;

  removeIssuesFromModule: (
    workspaceSlug: string,
    projectId: string,
    moduleId: string,
    issueIds: string[]
  ) => Promise<void>;
  changeModulesInIssue(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    addModuleIds: string[],
    removeModuleIds: string[]
  ): Promise<void>;
  archiveIssue: (workspaceSlug: string, projectId: string, issueId: string) => Promise<void>;
}

export class WorkspaceDraftIssues implements IWorkspaceDraftIssues {
  // local constants
  paginatedCount = 50;
  // observables
  paginationInfo: Omit<TWorkspaceDraftPaginationInfo<TWorkspaceDraftIssue>, "results"> | undefined = undefined;
  loader: TWorkspaceDraftIssueLoader = undefined;
  issuesMap: Record<string, TWorkspaceDraftIssue> = {};

  constructor() {
    makeObservable(this, {
      paginationInfo: observable,
      loader: observable.ref,
      issuesMap: observable,
      // computed
      issueIds: computed,
      // action
      fetchIssues: action,
      createIssue: action,
      updateIssue: action,
      deleteIssue: action,
      moveIssue: action,
      addCycleToIssue: action,
      addModulesToIssue: action,
    });
  }

  // computed
  get issueIds() {
    if (Object.keys(this.issuesMap).length <= 0) return [];
    return orderBy(Object.values(this.issuesMap), (issue) => convertToISODateString(issue["created_at"]), ["asc"]).map(
      (issue) => issue?.id
    );
  }

  // computed functions
  getIssueById = computedFn((issueId: string) => {
    if (!issueId || !this.issuesMap[issueId]) return undefined;
    return this.issuesMap[issueId];
  });

  // helper actions
  addIssue = (issues: TWorkspaceDraftIssue[]) => {
    if (issues && issues.length <= 0) return;
    runInAction(() => {
      issues.forEach((issue) => {
        if (!this.issuesMap[issue.id]) set(this.issuesMap, issue.id, issue);
        else update(this.issuesMap, issue.id, (prevIssue) => ({ ...prevIssue, ...issue }));
      });
    });
  };

  mutateIssue = (issueId: string, issue: Partial<TWorkspaceDraftIssue>) => {
    if (!issue || !issueId || !this.issuesMap[issueId]) return;
    runInAction(() => {
      set(this.issuesMap, [issueId, "updated_at"], getCurrentDateTimeInISO());
      Object.keys(issue).forEach((key) => {
        set(this.issuesMap, [issueId, key], issue[key as keyof TWorkspaceDraftIssue]);
      });
    });
  };

  removeIssue = async (issueId: string) => {
    if (!issueId || !this.issuesMap[issueId]) return;
    runInAction(() => unset(this.issuesMap, issueId));
  };

  generateNotificationQueryParams = (
    paramType: TDraftIssuePaginationType,
    filterParams = {}
  ): TWorkspaceDraftQueryParams => {
    const queryCursorNext: string =
      paramType === EDraftIssuePaginationType.INIT
        ? `${this.paginatedCount}:0:0`
        : paramType === EDraftIssuePaginationType.CURRENT
          ? `${this.paginatedCount}:${0}:0`
          : paramType === EDraftIssuePaginationType.NEXT && this.paginationInfo
            ? (this.paginationInfo?.next_cursor ?? `${this.paginatedCount}:${0}:0`)
            : `${this.paginatedCount}:${0}:0`;

    const queryParams: TWorkspaceDraftQueryParams = {
      per_page: this.paginatedCount,
      cursor: queryCursorNext,
      ...filterParams,
    };

    return queryParams;
  };

  // actions
  fetchIssues = async (
    workspaceSlug: string,
    loadType: TWorkspaceDraftIssueLoader,
    paginationType: TDraftIssuePaginationType = EDraftIssuePaginationType.INIT
  ) => {
    try {
      this.loader = loadType;

      // filter params and pagination params
      const filterParams = {};
      const params = this.generateNotificationQueryParams(paginationType, filterParams);

      // fetching the paginated workspace draft issues
      const draftIssuesResponse = await workspaceDraftService.getIssues(workspaceSlug, { ...params });
      if (!draftIssuesResponse) return undefined;

      const { results, ...paginationInfo } = draftIssuesResponse;
      runInAction(() => {
        if (results && results.length > 0) {
          this.addIssue(results as TWorkspaceDraftIssue[]);
          this.loader = undefined;
        } else {
          this.loader = "empty-state";
        }
        set(this, "paginationInfo", paginationInfo);
      });
      return draftIssuesResponse;
    } catch (error) {
      // set loader to undefined if errored out
      this.loader = undefined;
      throw error;
    }
  };

  createIssue = async (
    workspaceSlug: string,
    payload: Partial<TWorkspaceDraftIssue | TIssue>
  ): Promise<TWorkspaceDraftIssue | undefined> => {
    try {
      this.loader = "create";

      const response = await workspaceDraftService.createIssue(workspaceSlug, payload);
      if (response) {
        runInAction(() => set(this.issuesMap, response.id, response));
      }

      this.loader = undefined;
      return response;
    } catch (error) {
      this.loader = undefined;
      throw error;
    }
  };

  updateIssue = async (workspaceSlug: string, issueId: string, payload: Partial<TWorkspaceDraftIssue | TIssue>) => {
    const issueBeforeUpdate = clone(this.getIssueById(issueId));
    try {
      this.loader = "update";
      runInAction(() => {
        set(this.issuesMap, [issueId, "updated_at"], getCurrentDateTimeInISO());
        set(this.issuesMap, [issueId], { ...issueBeforeUpdate, ...payload });
      });
      const response = await workspaceDraftService.updateIssue(workspaceSlug, issueId, payload);
      this.loader = undefined;
      return response;
    } catch (error) {
      this.loader = undefined;
      runInAction(() => {
        set(this.issuesMap, [issueId], issueBeforeUpdate);
      });
      throw error;
    }
  };

  deleteIssue = async (workspaceSlug: string, issueId: string) => {
    try {
      this.loader = "delete";

      const response = await workspaceDraftService.deleteIssue(workspaceSlug, issueId);
      runInAction(() => unset(this.issuesMap, issueId));

      this.loader = undefined;
      return response;
    } catch (error) {
      this.loader = undefined;
      throw error;
    }
  };

  moveIssue = async (workspaceSlug: string, issueId: string, payload: Partial<TWorkspaceDraftIssue>) => {
    try {
      this.loader = "move";

      const response = await workspaceDraftService.moveIssue(workspaceSlug, issueId, payload);
      runInAction(() => unset(this.issuesMap, issueId));

      this.loader = undefined;
      return response;
    } catch (error) {
      this.loader = undefined;
      throw error;
    }
  };

  addCycleToIssue = async (workspaceSlug: string, issueId: string, cycleId: string) => {
    try {
      this.loader = "update";
      const response = await this.updateIssue(workspaceSlug, issueId, { cycle_id: cycleId });
      return response;
    } catch (error) {
      this.loader = undefined;
      throw error;
    }
  };

  addModulesToIssue = async (workspaceSlug: string, issueId: string, moduleIds: string[]) => {
    try {
      this.loader = "update";
      const response = this.updateIssue(workspaceSlug, issueId, { module_ids: moduleIds });
      return response;
    } catch (error) {
      this.loader = undefined;
      throw error;
    }
  };

  // dummies
  viewFlags: ViewFlags = { enableQuickAdd: false, enableIssueCreation: false, enableInlineEditing: false };
  groupedIssueIds: TGroupedIssues | TSubGroupedIssues | undefined = undefined;
  getIssueIds = (groupId?: string, subGroupId?: string) => undefined;
  getPaginationData = (groupId: string | undefined, subGroupId: string | undefined) => undefined;
  getIssueLoader = (groupId?: string, subGroupId?: string) => "loaded" as TLoader;
  getGroupIssueCount = (groupId: string | undefined, subGroupId: string | undefined, isSubGroupCumulative: boolean) =>
    undefined;
  removeCycleFromIssue = async (workspaceSlug: string, projectId: string, issueId: string) => {};
  addIssueToCycle = async (
    workspaceSlug: string,
    projectId: string,
    cycleId: string,
    issueIds: string[],
    fetchAddedIssues?: boolean
  ) => {};
  removeIssueFromCycle = async (workspaceSlug: string, projectId: string, cycleId: string, issueId: string) => {};

  removeIssuesFromModule = async (workspaceSlug: string, projectId: string, moduleId: string, issueIds: string[]) => {};
  changeModulesInIssue = async (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    addModuleIds: string[],
    removeModuleIds: string[]
  ) => {};
  archiveIssue = async (workspaceSlug: string, projectId: string, issueId: string) => {};
}

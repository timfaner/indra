import { Watcher } from "../../src";
import {
  IWatcherStoreService,
  WatcherEvents,
  ChallengeUpdatedEventPayload,
  ChallengeProgressedEventData,
  ChallengeStatus,
  ChallengeCompletedEventData,
  ChallengeCompletionFailedEventData,
  ChallengeOutcomeFailedEventData,
  ChallengeOutcomeSetEventData,
  StoredAppChallengeStatus,
} from "@connext/types";
import { expect } from ".";
import { AppWithCounterClass } from "./appWithCounter";
import { MiniFreeBalance } from "./miniFreeBalance";
import { bigNumberifyJson } from "@connext/utils";
import { NetworkContextForTestSuite } from "./contracts";

export type OutcomeSetResults = [
  ChallengeOutcomeSetEventData,
  ChallengeOutcomeSetEventData,
  ChallengeUpdatedEventPayload,
  ChallengeUpdatedEventPayload,
];

export type ChallengeCompleteResults = [ChallengeCompletedEventData, ChallengeCompletedEventData];

export const initiateDispute = async (
  app: AppWithCounterClass,
  freeBalance: MiniFreeBalance,
  watcher: Watcher,
  store: IWatcherStoreService,
  networkContext: NetworkContextForTestSuite,
  appChallengeUpdatedEvents: number = 1, // 1 for set state, 2 for set and progress
) => {
  // before starting, verify empty store
  const empty = await store.getAppChallenge(app.identityHash);
  expect(empty).to.be.undefined;
  let appChallengeUpdatedEventsCaught = 0;
  const [
    contractEventFreeBalance,
    finalContractEventApp,
    initiatedEventFreeBalance,
    initiatedEventApp,
    result,
  ] = await Promise.all([
    // FIXME: in the `.only`d test (test 2 on initiate), the test wont resolve
    // because this event is never emitted, instead the app dispute event
    // seems to be emitted twice?
    new Promise((resolve) =>
      watcher.on(
        WatcherEvents.ChallengeUpdatedEvent,
        async (data: ChallengeUpdatedEventPayload) => {
          if (data.identityHash === freeBalance.identityHash) {
            resolve(data);
          }
        },
      ),
    ),
    new Promise((resolve) =>
      watcher.on(
        WatcherEvents.ChallengeUpdatedEvent,
        async (data: ChallengeUpdatedEventPayload) => {
          if (data.identityHash === app.identityHash) {
            appChallengeUpdatedEventsCaught += 1;
          }
          if (appChallengeUpdatedEventsCaught === appChallengeUpdatedEvents) {
            resolve(data);
          }
        },
      ),
    ),
    new Promise((resolve) =>
      watcher.on(
        WatcherEvents.ChallengeProgressedEvent,
        async (data: ChallengeProgressedEventData) => {
          if (data.appInstanceId === freeBalance.identityHash) {
            resolve(data);
          }
        },
      ),
    ),
    new Promise((resolve) =>
      watcher.on(
        WatcherEvents.ChallengeProgressedEvent,
        async (data: ChallengeProgressedEventData) => {
          if (data.appInstanceId === app.identityHash) {
            resolve(data);
          }
        },
      ),
    ),
    watcher.initiate(app.identityHash),
  ]);
  expect(result).to.be.ok;

  // verify app + free balance challenge
  const appSetState = bigNumberifyJson(
    await app.getCurrentSetState(networkContext.ChallengeRegistry),
  );
  const fbSetState = bigNumberifyJson(await freeBalance.getSetState());
  const appFinalizesAt = appSetState.stateTimeout.add(
    await networkContext.provider.getBlockNumber(),
  );
  // fb is disputed first and automined, meaning that you should use
  // provider block - 1
  const fbFinalizesAt = fbSetState.stateTimeout
    .add(await networkContext.provider.getBlockNumber())
    .sub(1);
  const expected0 = {
    [app.identityHash]: {
      appStateHash: appSetState.appStateHash,
      identityHash: app.identityHash,
      versionNumber: appSetState.versionNumber,
      status: ChallengeStatus.IN_DISPUTE,
      finalizesAt: appFinalizesAt,
    },
    [freeBalance.identityHash]: {
      appStateHash: fbSetState.appStateHash,
      identityHash: freeBalance.identityHash,
      versionNumber: fbSetState.versionNumber,
      status: ChallengeStatus.IN_DISPUTE,
      finalizesAt: fbFinalizesAt,
    },
  };
  const contractEvents = {
    [app.identityHash]: finalContractEventApp,
    [freeBalance.identityHash]: contractEventFreeBalance,
  };
  const initiatedEvents = {
    [app.identityHash]: initiatedEventApp,
    [freeBalance.identityHash]: initiatedEventFreeBalance,
  };
  const transactions = {
    [app.identityHash]: (result as any).appChallenge,
    [freeBalance.identityHash]: (result as any).freeBalanceChallenge,
  };

  for (const appId of [app.identityHash, freeBalance.identityHash]) {
    // verify stored challenge
    const challenge = await store.getAppChallenge(appId);
    expect(challenge).to.containSubset(expected0[appId]);

    // verify stored contract event
    const setStateEvents = await store.getChallengeUpdatedEvents(appId);
    expect(setStateEvents.length).to.be.equal(1);
    expect(setStateEvents[0]).to.containSubset(expected0[appId]);

    // verify emitted events
    expect(contractEvents[appId]).to.containSubset(expected0[appId]);
    expect(initiatedEvents[appId]).to.containSubset({
      transaction: transactions[appId],
      appInstanceId: appId,
    });
  }

  // after first dispute, create and return other promises for other
  // dispute phases
  const outcomeSet = Promise.all([
    new Promise((resolve) => {
      watcher.on(
        WatcherEvents.ChallengeOutcomeSetEvent,
        async (data: ChallengeOutcomeSetEventData) => {
          if (data.appInstanceId === freeBalance.identityHash) {
            resolve(data);
          }
        },
      );
    }),
    new Promise((resolve, reject) => {
      watcher.on(
        WatcherEvents.ChallengeOutcomeSetEvent,
        async (data: ChallengeOutcomeSetEventData) => {
          if (data.appInstanceId === app.identityHash) {
            resolve(data);
          }
        },
      );
      watcher.once(
        WatcherEvents.ChallengeOutcomeFailedEvent,
        async (data: ChallengeOutcomeFailedEventData) => reject(data),
      );
    }),
    new Promise((resolve) =>
      watcher.on(
        WatcherEvents.ChallengeUpdatedEvent,
        async (data: ChallengeUpdatedEventPayload) => {
          if (data.identityHash === freeBalance.identityHash) {
            resolve(data);
          }
        },
      ),
    ),
    new Promise((resolve) =>
      watcher.on(
        WatcherEvents.ChallengeUpdatedEvent,
        async (data: ChallengeUpdatedEventPayload) => {
          if (data.identityHash === app.identityHash) {
            resolve(data);
          }
        },
      ),
    ),
  ]) as unknown as OutcomeSetResults;
  const verifyOutcomeSet = async (results: OutcomeSetResults) => {
    const [
      outcomeSetFbEvent,
      outcomeSetAppEvent,
      challengeUpdatedFbEvent,
      challengeUpdatedAppEvent,
    ] = results;
    const expected1 = {
      [app.identityHash]: {
        ...expected0[app.identityHash],
        status: StoredAppChallengeStatus.OUTCOME_SET,
      },
      [freeBalance.identityHash]: {
        ...expected0[freeBalance.identityHash],
        status: StoredAppChallengeStatus.OUTCOME_SET,
      },
    };
    const outcomeSetEvents = {
      [app.identityHash]: outcomeSetAppEvent,
      [freeBalance.identityHash]: outcomeSetFbEvent,
    };
    const challengeUpdatedEvents = {
      [app.identityHash]: challengeUpdatedAppEvent,
      [freeBalance.identityHash]: challengeUpdatedFbEvent,
    };

    for (const appId of [app.identityHash, freeBalance.identityHash]) {
      // verify stored events
      const events = await store.getChallengeUpdatedEvents(appId);
      expect(events.length).to.be.equal(2);
      expect(events[1]).to.containSubset(expected1[appId]);

      // verify stored challenges
      const challenge = await store.getAppChallenge(appId);
      expect(challenge).to.containSubset(expected1[appId]);

      // verify emitted events
      expect(outcomeSetEvents[appId]).to.containSubset({
        appInstanceId: appId,
        multisigAddress: freeBalance.multisigAddress,
      });
      expect(outcomeSetEvents[appId].transaction).to.be.ok;
      expect(challengeUpdatedEvents[appId]).to.containSubset(expected1[appId]);
    }
  };

  const completed = Promise.all([
    new Promise((resolve, reject) => {
      watcher.on(
        WatcherEvents.ChallengeCompletedEvent,
        async (data: ChallengeCompletedEventData) => {
          if (data.appInstanceId === app.identityHash) {
            resolve(data);
          }
        },
      );
      watcher.once(
        WatcherEvents.ChallengeCompletionFailedEvent,
        async (data: ChallengeCompletionFailedEventData) => reject(data),
      );
    }),
    new Promise((resolve) => {
      watcher.on(
        WatcherEvents.ChallengeCompletedEvent,
        async (data: ChallengeCompletedEventData) => {
          if (data.appInstanceId === freeBalance.identityHash) {
            resolve(data);
          }
        },
      );
    }),
  ]) as unknown as ChallengeCompleteResults;
  const verifyCompleted = async (res: ChallengeCompleteResults) => {
    const [appDisputeCompleted, freeBalanceDisputeCompleted] = res;
    const expected2 = {
      [app.identityHash]: {
        ...expected0[app.identityHash],
        status: StoredAppChallengeStatus.CONDITIONAL_SENT,
      },
      [freeBalance.identityHash]: {
        ...expected0[freeBalance.identityHash],
        status: StoredAppChallengeStatus.CONDITIONAL_SENT,
      },
    };
    const completedEvents = {
      [app.identityHash]: appDisputeCompleted,
      [freeBalance.identityHash]: freeBalanceDisputeCompleted,
    };
    for (const appId of [app.identityHash, freeBalance.identityHash]) {
      // verify stored challenge
      const challenge = await store.getAppChallenge(appId);
      expect(challenge).to.containSubset(expected2[appId]);

      // verify emitted events
      expect(completedEvents[appId]).to.containSubset({
        appInstanceId: appId,
        multisigAddress: freeBalance.multisigAddress,
      });
    }
  };

  return {
    outcomeSet,
    verifyOutcomeSet,
    completed,
    verifyCompleted,
  };
};

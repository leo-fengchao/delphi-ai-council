import { setup, assign, fromPromise } from 'xstate';
import type { SiteAdapter } from '../shared/adapter-schema';
import type { SessionState } from '../shared/session-state';
import { openCouncilTabs, type CouncilTabs } from './council-tabs';
import { runStageParallel, driveLegResilient, type LegResult, type BroadcastHooks } from './orchestrator';
import { saveSession } from '../shared/session-state';

export interface CouncilContext {
  session: SessionState;
  adapters: SiteAdapter[];
  /** 本轮议会的窗口/标签页句柄。stage1 开窗后赋值；新一轮 START / 中止 ABORT 时清空。 */
  council?: CouncilTabs;
  hooks?: BroadcastHooks;
}

export type CouncilEvents =
  | { type: 'START'; prompt: string; enableThinking: boolean; chairpersonId: string; adapters: SiteAdapter[] }
  | { type: 'RESUME'; session: SessionState; adapters: SiteAdapter[] }
  | { type: 'ABORT' }
  | { type: 'STAGE1_DONE' }
  | { type: 'STAGE2_DONE' }
  | { type: 'STAGE3_DONE' }
  | { type: 'ERROR'; error: string };

// Helper to format the cross-review prompt
function buildReviewPrompt(session: SessionState): string {
  const responses = Object.values(session.legs)
    .filter(l => l.status === 'done' && l.text)
    .map((l, idx) => `=== 匿名回答 ${String.fromCharCode(65 + idx)} ===\n${l.text}\n=== 结束匿名回答 ${String.fromCharCode(65 + idx)} ===`)
    .join('\n\n');

  return `请根据以下提供的原始问题以及各个匿名AI的回答，进行交叉评审。
原始问题：
${session.prompt}

各位AI的回答：
${responses}

要求：
1. 请客观、中立地分别点评以上回答的优缺点。
2. 给出你认为最合理的综合意见。`;
}

// Helper to format the chairperson prompt
function buildChairpersonPrompt(session: SessionState): string {
  const responses = Object.values(session.legs)
    .filter(l => l.status === 'done' && l.text)
    .map((l, idx) => `=== 初始回答 ${String.fromCharCode(65 + idx)} ===\n${l.text}`)
    .join('\n\n');

  const reviews = Object.entries(session.reviews || {})
    .filter(([_, text]) => !!text)
    .map(([id, text], idx) => `=== 评审意见 ${idx + 1} ===\n${text}`)
    .join('\n\n');

  return `作为本次AI议会的主席，请根据原始问题、各家的初始回答以及交叉评审意见，输出最终的结论。
原始问题：
${session.prompt}

初始回答：
${responses}

交叉评审意见：
${reviews}

请严格按以下格式输出（必须包含四个分隔符区块）：
===ANSWER===
这里写最终综合得出的最佳回答
===/ANSWER===
===CONSENSUS===
这里列出大家达成共识的核心观点
===/CONSENSUS===
===DISPUTED===
这里列出大家存在分歧争议的观点
===/DISPUTED===
===CONFIDENCE===
这里写出一个0到100的置信度评分（仅数字）
===/CONFIDENCE===`;
}

function parseChairpersonSummary(text: string) {
  const extract = (tag: string) => {
    const regex = new RegExp(`===${tag}===([\\s\\S]*?)===/${tag}===`, 'i');
    const match = text.match(regex);
    return match && match[1] ? match[1].trim() : '';
  };
  return {
    finalAnswer: extract('ANSWER'),
    consensus: extract('CONSENSUS'),
    disputes: extract('DISPUTED'),
    confidence: extract('CONFIDENCE'),
    rawText: text
  };
}

export const councilMachine = setup({
  types: {
    context: {} as CouncilContext,
    events: {} as CouncilEvents,
  },
  actors: {
    runStage1: fromPromise<{results: LegResult[], council: CouncilTabs}, { context: CouncilContext }>(async ({ input }) => {
      const { session, adapters, hooks } = input.context;
      let council = input.context.council;
      if (!council) {
        council = await openCouncilTabs(adapters);
        // Bind tabs to session
        for (const a of adapters) {
          if (session.legs[a.id]) {
            session.legs[a.id]!.tabId = council.tabs.get(a.id);
            session.legs[a.id]!.windowId = council.windows.get(a.id);
          }
        }
        await saveSession(session);
      }
      const results = await runStageParallel(session, council, adapters, session.prompt, hooks || {});
      return { results, council };
    }),
    runStage2: fromPromise<LegResult[], { context: CouncilContext }>(async ({ input }) => {
      const { session, adapters, council, hooks } = input.context;
      // Phase 2: 全员互评 (Q4 decision)
      const reviewPrompt = buildReviewPrompt(session);
      
      // We need to reset the leg statuses for stage 2, or track them separately. 
      // For simplicity, since the prompt is sent and we extract the result, 
      // we'll run it and store the results in `session.reviews`.
      // Note: We don't want `runStageParallel` to overwrite `session.legs` if we can avoid it, 
      // but `runStageParallel` calls `driveLegResilient` which mutates `session.legs`. 
      // We'll let it mutate for now (so UI shows progress), but we must save the texts to `reviews`.
      // To do this cleanly, we'll reset legs to 'pending' before running.
      for (const adapter of adapters) {
         if (session.legs[adapter.id]) {
           session.legs[adapter.id]!.status = 'pending';
           session.legs[adapter.id]!.text = undefined;
         }
      }
      await saveSession(session);

      const results = await runStageParallel(session, council!, adapters, reviewPrompt, hooks || {});
      return results;
    }),
    runStage3: fromPromise<LegResult, { context: CouncilContext }>(async ({ input }) => {
      const { session, adapters, council, hooks } = input.context;
      
      // Phase 3: 主席综合
      const chairpersonAdapter = adapters.find(a => a.id === session.chairpersonId) || adapters[0];
      if (!chairpersonAdapter) throw new Error("No chairperson available");
      
      const chairPrompt = buildChairpersonPrompt(session);
      
      // Only drive the chairperson leg
      if (session.legs[chairpersonAdapter.id]) {
        session.legs[chairpersonAdapter.id]!.status = 'pending';
        session.legs[chairpersonAdapter.id]!.text = undefined;
      }
      await saveSession(session);
      
      const res = await driveLegResilient(session, council!, chairpersonAdapter, chairPrompt, hooks || {});
      if (hooks && hooks.onLegResult) {
        hooks.onLegResult(res);
      }
      return res;
    })
  }
}).createMachine({
  id: 'council',
  initial: 'idle',
  context: ({ input }) => ({
    session: (input as any).session,
    adapters: (input as any).adapters || [],
    council: (input as any).council,
    hooks: (input as any).hooks,
  }),
  on: {
    START: {
      target: '.stage1',
      actions: assign({
        adapters: ({ event }) => event.adapters,
        // ② 清掉上一轮的 council 句柄：否则 runStage1 会误判「已有窗口」而跳过 openCouncilTabs，
        //    导致第二轮不再按网格平铺、各家窗口层叠在默认位置。
        council: () => undefined,
        // ③ 全新构造 session，不再 spread 旧 session：避免把上一轮的 summary / reviews 带进新一轮
        //    （否则旧的主席综合结论会残留在页面上）。
        session: ({ event }) => {
          const legs = Object.fromEntries(event.adapters.map(a => [a.id, { adapterId: a.id, displayName: a.displayName, status: 'pending' as const }]));
          return {
            id: `s_${Date.now()}`,
            prompt: event.prompt,
            enableThinking: event.enableThinking,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            adapterIds: event.adapters.map(a => a.id),
            legs,
            chairpersonId: event.chairpersonId,
            reviews: undefined,
            summary: undefined,
            status: 'stage1' as const,
          };
        }
      })
    },
    // ① 中止议事：任意阶段都可中途停止。退出当前 stage 会停掉正在 invoke 的 actor
    //    （在途的 sendMessage 不再推进状态机）；窗口的关闭由 App 侧 closeAllTabs 负责。
    //    把 session 标记为 finished 并落盘：避免在途腿的延迟回写把它又变回「可恢复」。
    ABORT: {
      target: '.idle',
      actions: assign({
        council: () => undefined,
        session: ({ context }) => {
          if (!context.session) return context.session;
          const aborted = { ...context.session, status: 'finished' as const };
          saveSession(aborted);
          return aborted;
        },
      }),
    }
  },
  states: {
    idle: {
      on: {
        RESUME: [
          { guard: ({ event }) => event.session.status === 'stage1', target: 'stage1', actions: assign({ session: ({ event }) => event.session, adapters: ({ event }) => event.adapters }) },
          { guard: ({ event }) => event.session.status === 'stage2', target: 'stage2', actions: assign({ session: ({ event }) => event.session, adapters: ({ event }) => event.adapters }) },
          { guard: ({ event }) => event.session.status === 'stage3', target: 'stage3', actions: assign({ session: ({ event }) => event.session, adapters: ({ event }) => event.adapters }) },
          { guard: ({ event }) => event.session.status === 'finished', target: 'finished', actions: assign({ session: ({ event }) => event.session, adapters: ({ event }) => event.adapters }) }
        ]
      }
    },
    stage1: {
      entry: ({ context }) => { context.session.status = 'stage1'; saveSession(context.session); },
      invoke: {
        src: 'runStage1',
        input: ({ context }) => ({ context }),
        onDone: {
          target: 'stage2',
          actions: assign({
            council: ({ event }) => event.output.council
          })
        },
        onError: {
          target: 'error',
          actions: ({ event }) => console.error("Stage 1 Error:", event.error)
        }
      }
    },
    stage2: {
      entry: ({ context }) => { context.session.status = 'stage2'; saveSession(context.session); },
      invoke: {
        src: 'runStage2',
        input: ({ context }) => ({ context }),
        onDone: {
          target: 'stage3',
          actions: assign({
            session: ({ context, event }) => {
              const reviews: Record<string, string> = {};
              event.output.forEach(res => {
                if (res.ok && res.text) reviews[res.adapterId] = res.text;
              });
              const newSession = { ...context.session, reviews };
              saveSession(newSession);
              return newSession;
            }
          })
        },
        onError: {
          target: 'error',
          actions: ({ event }) => console.error("Stage 2 Error:", event.error)
        }
      }
    },
    stage3: {
      entry: ({ context }) => { context.session.status = 'stage3'; saveSession(context.session); },
      invoke: {
        src: 'runStage3',
        input: ({ context }) => ({ context }),
        onDone: {
          target: 'finished',
          actions: assign({
            session: ({ context, event }) => {
              const res = event.output;
              if (res.ok && res.text) {
                context.session.summary = parseChairpersonSummary(res.text);
              }
              const newSession = { ...context.session, status: 'finished' as const };
              saveSession(newSession);
              return newSession;
            }
          })
        },
        onError: {
          target: 'error',
          actions: ({ event }) => console.error("Stage 3 Error:", event.error)
        }
      }
    },
    finished: {
      // removed type: 'final' to allow restarting
    },
    error: {}
  }
});

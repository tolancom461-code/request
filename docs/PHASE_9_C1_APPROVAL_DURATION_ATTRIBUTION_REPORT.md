# P-009-C1 — Approval Duration Attribution Correction Report

## النطاق والنتيجة

هذا تصحيح ضيق لـ**B-9-001 فقط** ضمن Phase 9. لم تُعد تصميمات التقارير أو واجهة المستخدم، ولم يتغير تعريف KPI في Dashboard، ولم تبدأ Phase 10. أصلح التغيير دقة `byManager.averageApprovalCycleMinutes` في تقرير أداء الاعتمادات مع إبقاء `approved` و`returned` و`rejected` كعدادات أحداث مستقلة.

## العيب السابق والتصحيح

كان المسار السابق يحسب مدة `first pending_approval → first approved` من `RequestStatusHistory` ثم يضيفها إلى مجموعة المدير لكل صف `RequestApproval`، حتى إن كان القرار `returned` أو `rejected`. لذلك كان يمكن لإرجاع مدير A أن يرث مدة اعتماد لاحقة نفذها مدير B بعد إعادة تقديم الطلب.

أصبح `ReportsService.approvals()` يزيد عداد القرار دائمًا، لكنه يضيف مدة السجل فقط عندما تكون `row.decision === "approved"`. لا تزال المدة مشتقة من `RequestStatusHistory.occurredAt` عبر `lifecycleDurations()`، ولا تستخدم `updatedAt` أو AuditLog. المدير الذي لا يملك قرار اعتماد مؤهلًا يعيد `null`، ويعرض CSV ذلك كـ`N/A`.

| جانب | قبل C1 | بعد C1 |
|---|---|---|
| counts | event-level | لم يتغير |
| returned manager duration | قد يرث اعتمادًا لاحقًا | `null` ما لم يملك اعتمادًا مؤهلًا مستقلًا |
| rejected manager duration | قد يرث مدة غير متعلقة | `null` ما لم يملك اعتمادًا مؤهلًا مستقلًا |
| approving manager duration | محسوبة من history | مستمرة ومنسوبة فقط لصف approved الخاص به |
| CSV approvals | يستخدم `approvals()` | يعرض القيم المصححة نفسها |

## اختبارات القبول الفعلية

| الحالة | النتيجة | الإثبات |
|---|---|---|
| TC-P9C1-01 cross-manager return → resubmit → approve | PASS | مدير A: returned=1، approved=0، duration=null؛ مدير B: approved=1، duration رقمية؛ branch/counts وCSV صحيحة |
| TC-P9C1-02 reject-only attribution | PASS | مدير الرفض: rejected=1، approved=0، duration=null؛ إعادة التقديم rejected terminal ترفض؛ CSV يعرض N/A |
| Phase 9 existing reports | PASS | 7/7 في ملف Phase 9 بعد إضافة حالتي C1 |
| Phase 5/P-005-C1/Phase 6 relevant regression | PASS | 21/21 في أربعة ملفات، يشمل returned edit/resubmit ومدير الفرع |
| Full repository regression | PASS | 26 ملفًا / 104 اختبارًا |

## بوابات الجودة

نجح `prisma validate` و`prisma generate` و`pnpm run check` و`pnpm run build`. أنتج build/PWA Service Worker و64 إدخال precache. بقي تحذير bundle الأكبر من 500KB وتحذير حداثة `baseline-browser-mapping` غير حاجبين ومؤجلين؛ لم تُجر أي optimization أو redesign خارج C1.

## النطاق وقاعدة البيانات

تقتصر تغييرات التنفيذ على `apps/api/src/reports.service.ts` واختبار `tests/phase9-reports-dashboard.integration.test.ts` ووثائق C1. لا يوجد فرق في `prisma/schema.prisma` أو `prisma/migrations`. بصمة schema هي `5c7eb330310f18b74f05e269dedf94f18deb355fc6744ae7ebad4c045224cfdb`، وبصمات المهاجرات موثقة في `phase9/c1_scope_evidence.md`.

لم يتغير Dashboard أو تقارير requests/branches/items/suppliers/status-lifecycle/warehouse أو صلاحيات reports أو CSV formula injection أو AR/EN/UR أو PWA. لا توجد عيوب حاجبة معروفة في هذا التصحيح؛ يبقى الاعتماد النهائي لمراجعة مستقلة وفق stop rule.

APPROVAL DURATION ATTRIBUTED ONLY TO APPROVING MANAGER: YES

RETURN DECISION EXCLUDED FROM MANAGER APPROVAL DURATION: YES

REJECT DECISION EXCLUDED FROM MANAGER APPROVAL DURATION: YES

CROSS MANAGER RETURN THEN APPROVE REGRESSION PASSED: YES

APPROVAL CSV EXPORT REGRESSION PASSED: YES

FULL REGRESSION PASSED: YES

PRISMA SCHEMA CHANGED: NO

PRISMA MIGRATIONS CHANGED: NO

PHASE 10 STARTED: NO

B-9-001 CLOSED: YES

PHASE 9 READY FOR FORWARD GATE REVIEW: YES

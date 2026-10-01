# Phase 8 — تقرير تنفيذ الإشعارات وسجل التدقيق ونشاط المستخدم

## النطاق المنفذ

نُفذت **Phase 8 فقط** وفق العقد. أضيفت إشعارات أعمال داخل التطبيق فقط، ومركز إشعارات مملوك للمستلم، وقراءة إدارية مقيدة لسجل التدقيق، وعرض نشاط مستخدم مشتق من `AuditLog`. لم يُنفذ بريد إلكتروني أو SMS أو Push أو تقارير أو KPI أو تصدير أو جدولة أو أي عمل من Phase 9 أو Phase 10.

| القدرة | التنفيذ الفعلي |
|---|---|
| الإشعارات | صفوف `Notification` دائمة مع payload آمن ومركز للمستخدم الحالي فقط |
| fan-out | حل المستلمين خادميًا من الصلاحية الفعالة و`UserBranchScope` مع إزالة التكرار واستبعاد غير النشطين |
| الذرية | إدراج الإشعارات داخل معاملة Prisma السلطوية نفسها للانتقالات المطلوبة |
| التدقيق | API وشاشة إدارية للقراءة فقط مع تصفية allowlisted وredaction على الخادم |
| النشاط | شاشة وAPI إداريان يعيدان أحداث `AuditLog.actorUserId` للمستخدم المستهدف فقط |
| اللغات | العربية RTL والإنجليزية LTR والأردية RTL في مركز الإشعارات والتدقيق والنشاط |

## مصفوفة الأحداث والاستراتيجية الذرية

تعمل `NotificationService` داخل الـ`TransactionClient` الذي تملكه خدمة workflow القائمة. فلا توجد معاملة جذرية ثانية لإنشاء نجاح ظاهري، وتبقى إشعارات النجاح غائبة عند rollback أو تعارض `rowVersion`.

| الحدث الملتزم | النوع | المستلمون | الموضع الذري |
|---|---|---|---|
| دخول `pending_approval` | `request.pending_approval` | مستخدمو `request.review` النشطون ضمن نطاق الفرع، مع semantics System Admin المعتمدة | `RequestSubmissionService.transition` |
| return | `request.returned` | منشئ الطلب | قرار المدير نفسه |
| reject | `request.rejected` | منشئ الطلب | قرار المدير نفسه |
| approve + handoff | `request.approved` و`warehouse.request_available` | المنشئ + مستخدمو `warehouse.process` النشطون في نطاق الفرع | اعتماد المدير والتحويل إلى المستودع |
| ready/dispatched/completed | `warehouse.ready` و`warehouse.dispatched` و`warehouse.completed` | منشئ الطلب | انتقالات المستودع الصارمة |

## واجهات API والواجهة

تقدم `/api/v1/notifications` قائمة paginated للمستخدم الحالي فقط مع `state` و`direction` المقيدين، وتقدم `/unread-count`، وعمليتي `POST /:notificationId/read` و`POST /read-all`. تظل عمليات POST محمية بـCSRF، وread idempotent، ولا تقبل API معرف مستلم من المتصفح.

تقدم `/api/v1/admin/audit-logs` و`/api/v1/admin/users/:userId/activity` قراءة فقط بعد `admin.manage`. يُصادق الخادم على UUID والتصفية والصفحات والفرز، وينقح المفاتيح الحساسة في response فقط، بلا تعديل للسجل المخزن. تعرض واجهة T3 + I1 badge وعدّاد unread ومركز إشعارات وحالات empty/loading/error/offline، وسجل تدقيق ونشاط مستخدم مقروءين فقط.

## الاختبارات والتحقق

| البوابة | النتيجة الفعلية |
|---|---|
| Phase 8 TiDB integration | 5/5 PASS |
| Phase 8 UI contract | 4/4 PASS؛ ليس بديلًا عن DOM interaction |
| إعادة اختبار تنظيف Phase 6 و7 | 9/9 PASS |
| نزاهة قاعدة البيانات الموروثة | 12/12 PASS |
| الانحدار الكامل | 24 ملفًا، 93/93 PASS |
| Prisma validate/generate | PASS |
| TypeScript | PASS بعد التصحيحات النهائية |
| Production build / PWA | PASS؛ تم توليد service worker وprecache |

تمت ملاحظة مهلة Prisma الافتراضية ذات 5 ثوانٍ عند تحميل تفاصيل طلب تحت ضغط TiDB بعد fan-out، فتمت مواءمة `requestDetail` مع سياسة المعاملات المعتمدة (`maxWait: 10_000`, `timeout: 60_000`). لا يغير ذلك الحالة أو المخطط أو semantics workflow. كما حُدث ترتيب تنظيف fixtures القديمين لـPhase 6/7 بحذف إشعارات المستلم أولًا استجابة إلى FK الموجود أصلًا في نموذج Notification.

## الأدلة المرئية والأمن

استُخدمت fixtures مؤقتة محدودة ثم نُظفت بالكامل. تؤكد الأدلة العربية RTL badge وقائمة unread وحالة read، وسجل التدقيق والنشاط وoffline؛ وتؤكد الأدلة الإنجليزية LTR والأردية RTL أمثلة returned/rejected/approved/completed. لا تحتوي اللقطات أو الحزمة على شاشة دخول أو كلمة مرور أو token أو DSN أو سر.

## Prisma والنطاق والقيود

لم تتغير `prisma/schema.prisma` أو `prisma/migrations`. سجل تدقيق النطاق وبصمات SHA-256 موجود في `phase8/database_unchanged_evidence.md`. لم يبدأ أي نطاق Phase 9 أو Phase 10.

القيد غير الحاجب الوحيد هو أن harness الواجهة المتاح لا يقدم DOM interaction آليًا؛ لذلك لا يُعرض اختبار العقد كاختبار DOM، وقد استكمل بلقطات متصفح فعلية وfixtures تُنظف بعد التحقق. لا توجد عيوب **BLOCKING** معروفة بعد 93/93.

IN APP NOTIFICATION CENTER IMPLEMENTED: YES

NOTIFICATION RECIPIENT OWNERSHIP ENFORCED SERVER SIDE: YES

BRANCH SCOPED MANAGER NOTIFICATIONS VERIFIED: YES

BRANCH SCOPED WAREHOUSE NOTIFICATIONS VERIFIED: YES

REQUEST CREATOR STATUS NOTIFICATIONS VERIFIED: YES

WORKFLOW NOTIFICATIONS ARE TRANSACTIONALLY CONSISTENT: YES

NOTIFICATION READ MUTATIONS ARE CSRF PROTECTED: YES

AUDIT LOG ADMIN READ ONLY UI API IMPLEMENTED: YES

AUDIT RESPONSE SENSITIVE DATA REDACTION VERIFIED: YES

USER ACTIVITY VIEW IMPLEMENTED FROM AUTHORITATIVE AUDIT DATA: YES

REQUEST STATUS HISTORY REMAINS AUTHORITATIVE: YES

ARABIC RTL PHASE 8 UI VERIFIED: YES

ENGLISH LTR PHASE 8 UI VERIFIED: YES

URDU RTL PHASE 8 UI VERIFIED: YES

FULL REGRESSION PASSED: YES

PHASE 8 FOCUSED TESTS PASSED: YES

PRISMA SCHEMA CHANGED: NO

PRISMA MIGRATIONS CHANGED: NO

UNEXPLAINED DATABASE DRIFT: NO

PHASE 9 STARTED: NO

BLOCKING DEFECTS REMAIN: NO

PHASE 8 READY FOR INDEPENDENT REVIEW: YES

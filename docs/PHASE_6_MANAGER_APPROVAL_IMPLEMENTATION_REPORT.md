# تقرير تنفيذ Phase 6 — سير مراجعة واعتماد مدير الفرع

**المشروع:** Restaurant Branch Requisition  
**النطاق المنفذ:** Phase 6 فقط  
**حالة الإغلاق:** جاهز لمراجعة مستقلة، مع قيد دليل مرئي غير حاجب موثق أدناه.

## ملخص تنفيذي

نفذت Phase 6 مسار المراجعة الخادمي لمدير الفرع على الطلبات ذات الحالة `pending_approval`. يقتصر الوصول على أذونات المراجعة والقرار وعلى نطاقات الفروع المخزنة خادميًا. يسمح المسار بتعديل سطر معلق أو استبعاده منطقيًا، ثم بإرجاع الطلب أو رفضه بسبب إلزامي، أو اعتماده. الاعتماد ينشئ قرار مدير وسجل حالة وتدقيق، ثم يحول الطلب تلقائيًا إلى `sent_to_warehouse` في المعاملة نفسها، من دون إنشاء واجهات أو عمليات مستودع لاحقة.

| محور الإغلاق | النتيجة الفعلية |
|---|---|
| الانحدار الكامل | 20 ملفات، 76 اختبارًا، جميعها PASS |
| الانحدار المستهدف | 6 ملفات، 39 اختبارًا، جميعها PASS |
| Prisma validate/generate | PASS |
| TypeScript | PASS |
| بناء الإنتاج وPWA | PASS؛ تم توليد service worker و64 مدخل precache |
| Prisma schema/migrations | لم تتغير |
| Phase 7 | لم تبدأ |

## النطاق المنفذ

أضيفت مساحة API محمية باسم `/api/v1/manager/requests`، وخدمة قرار الذرية، وواجهة `#/manager/requisitions` وصفحة مراجعة متداخلة. تعرض الواجهة صندوق الطلبات المعلقة، سياق الطلب، الأسطر واللقطات المجمدة، سجل الحالة والقرارات، وحوارات التعديل والاستبعاد والإرجاع والرفض والاعتماد. تدعم الواجهة العربية والأردية RTL والإنجليزية LTR، وتمنع الطفرات عند انقطاع الشبكة وتعرض التعارض على مستوى `rowVersion` مع إجراء تحديث صريح.

> لا تنفذ هذه المرحلة أي قائمة تجهيز أو قبول أو صرف أو إشعار أو تقرير أو خطوة مستودع يدوية. الحد الوحيد المتصل بالمستودع هو التحويل النظامي المسموح به من `approved` إلى `sent_to_warehouse` داخل اعتماد المدير.

## مسارات API المنفذة

| الطريقة | المسار | الإذن الخادمي | الدلالة |
|---|---|---|---|
| GET | `/manager/requests` | `request.review` | قائمة pending ضمن مدى المدير مع بحث وفلاتر وترتيب وترقيم صفحات |
| GET | `/manager/requests/:requestId` | `request.review` | تفصيل طلب مقيد بالفرع |
| GET | `/manager/requests/:requestId/items/:itemId/units` | `request.review` | وحدات نشطة وصحيحة لسطر معلق |
| PATCH | `/manager/requests/:requestId/items/:itemId` | `request.review` | تعديل كمية ووحدة سطر معلق مع `expectedRowVersion` |
| POST | `/manager/requests/:requestId/items/:itemId/exclude` | `request.review` | استبعاد منطقي بسبب إلزامي |
| POST | `/manager/requests/:requestId/approve` | `request.approve` | قرار اعتماد وتحويل نظامي تلقائي |
| POST | `/manager/requests/:requestId/return` | `request.return` | إرجاع بسبب إلزامي |
| POST | `/manager/requests/:requestId/reject` | `request.reject` | رفض بسبب إلزامي |

تتحقق جميع الطفرات من CSRF ومن `expectedRowVersion`، وتقفل سجل الطلب بـ`SELECT … FOR UPDATE` قبل فحص الحالة والمدى وكتابة أثر العملية.

## التفويض والمدى والذرية

يفرض المتحكم الأذونات الدقيقة قبل استدعاء الخدمة، بينما يعيد مستوى الخدمة التحقق من مدى الفرع داخل المعاملة المقفلة. لا تقبل قائمة inbox أو تفاصيل التخمين أو تعديل السطر أو القرار أي `branchId` عميل كبديل عن نطاق المستخدم. يسمح دور `branch_manager` بأذونات `request.review` و`request.approve` و`request.return` و`request.reject` بعد تشغيل seed idempotent للصلاحيات.

تجمع معاملة تعديل السطر: قفل الطلب، اختبار pending والنسخة والمدى، اختبار وحدة الصنف والكمية، تعديل اللقطة الحسابية، سجل التدقيق `manager_pending_line_updated`، زيادة `rowVersion`، وإعادة تفصيل committed state. يجمع الاستبعاد المنطقي المسار نفسه ويخزن `lineStatus=excluded` و`removedByUserId` و`removedAt` و`removalReason` مع audit `manager_pending_line_excluded`؛ لا يحذف صف `request_items`.

## قرارات المدير والتحول التلقائي

| القرار | المتطلب | الأثر الذري |
|---|---|---|
| Return | سبب غير فارغ | `RequestApproval(returned)` وسجل `pending_approval → returned` وaudit `manager_request_returned` وزيادة النسخة؛ يبقى `submittedAt` الأصلي |
| Reject | سبب غير فارغ | `RequestApproval(rejected)` وسجل `pending_approval → rejected` وaudit `manager_request_rejected` وزيادة النسخة؛ يصبح الطلب طرفيًا لمسارات الموظف والمدير العادية |
| Approve | سطر نشط واحد على الأقل ولقطات مكتملة | `RequestApproval(approved)` وaudit `manager_request_approved`، ثم `approved → sent_to_warehouse` كسجل نظامي وaudit `request_sent_to_warehouse_automatically` وتعيين `approvedAt` و`warehouseAvailableAt` داخل المعاملة نفسها |

ينفذ فحص `updateMany` المشروط بالحالة والنسخة عملية claim نهائية تمنع التزامن من تثبيت قرارين. أثبت TC-P6-05 نجاح قرار واحد فقط عند السباق وبقاء سجل قرار/تاريخ واحد.

## التحقق والنتائج

| البوابة | النتيجة الفعلية | الدليل |
|---|---|---|
| اختبار Phase 6 المركز | 5/5 PASS؛ 327.92 ثانية | `phase6_focused_expanded.log` |
| اختبار عقد الواجهة | 4/4 PASS؛ 267 مللي ثانية | `phase6_ui_contract.log` |
| انحدار P5/P-005-C1/security/Phase 6 | 39/39 PASS في 6 ملفات؛ 1098.54 ثانية | `phase6_targeted_regression.log` |
| الانحدار الكامل | 76/76 PASS في 20 ملفًا؛ 1437.96 ثانية | `phase6_full_regression.log` |
| Prisma | validate وgenerate PASS | `phase6_prisma_check_build_pwa.log` |
| TypeScript | PASS | `phase6_prisma_check_build_pwa.log` |
| الإنتاج/PWA | build PASS؛ 64 precache entries و`sw.js` | `phase6_prisma_check_build_pwa.log` |
| فحص schema/migrations | فروق صفرية للمخطط وللمهاجرات | `phase6_scope_schema_audit.log` |

يغطي TC-P6-03 تحديدًا المسار العابر للمراحل: إرجاع مدير بسبب، مع بقاء `submittedAt`، ثم تعديل/إعادة تقديم الطلب المعاد المتوافق مع P-005-C1، ثم اعتماد وتحويل تلقائي. اجتاز اختبار Phase 5 الأساسي واختبار P-005-C1 الذري ضمن الانحدار المستهدف والكامل.

## الدليل المرئي

التقطت 11 لقطة تشغيلية فعلية، لا mockups، من جلسة مدير مؤقتة مقيدة بفرع واحد وطلب pending حقيقيين ثم نُظفت بياناتها بالكامل. تشمل inbox عربي RTL، review عربي RTL، حوار تعديل، حوار استبعاد، حوار Return، حوار Reject، تأكيد Approve، inbox إنجليزي LTR، inbox وreview أرديين RTL، وحالة تعارض `rowVersion` عربية/أردية حقيقية تعرض التحديث.

توفر لقطتا `10_manager_review_ur_rtl.webp` و`11_manager_stale_conflict_ur_rtl.webp` دليلاً فعليًا لصفحة manager review ضمن viewport بمقاس **893×768**، وهو عرض tablet/narrow موثق. لا توجد لقطة بديلة أو محاكاة في الحزمة، ولا يبقى قيد دليل مرئي مفتوح.

## التغييرات والحدود

تفصل قائمة الملفات الكاملة وعقود API والمصفوفات في مجلد `phase6/`. لا توجد تعديلات Prisma schema أو migrations، ولا واجهة مخزون أو شراء أو تجهيز أو جاهز أو صرف أو مكتمل أو إشعارات أو تقارير. لا تبدأ هذه الحزمة Phase 7، ويجب أن تتوقف الأعمال عند هذا التقرير إلى أن يصدر مراجع مستقل تعليمات صريحة.

## الملاحظات المعروفة

تحذير حجم bundle من Vite وقدم بيانات `baseline-browser-mapping` تحذيران بناء غير حاجبين؛ البناء/PWA نجحا. اختبار الواجهة المتاح هو اختبار عقد مصدر من 4 حالات لأن stack لا يتضمن DOM testing library؛ جرى استكماله بلقطات متصفح حقيقية وتدفق دخول/API فعلي. لا توجد بيانات placeholder أو mock في منطق Phase 6 أو أدلة اللقطات.

MANAGER PENDING INBOX IMPLEMENTED: YES

MANAGER BRANCH SCOPE ENFORCED SERVER SIDE: YES

REQUEST REVIEW PERMISSIONS VERIFIED: YES

PENDING LINE EDIT IS ATOMIC AND AUDITED: YES

PENDING LINE EXCLUSION IS LOGICAL AND AUDITED: YES

RETURN REQUIRES REASON AND CREATES APPROVAL HISTORY AUDIT: YES

REJECT REQUIRES REASON AND CREATES APPROVAL HISTORY AUDIT: YES

APPROVE CREATES MANAGER DECISION ATOMICALLY: YES

APPROVED AUTO HANDOFF TO SENT_TO_WAREHOUSE IS ATOMIC: YES

WAREHOUSE_AVAILABLE_AT SET ON APPROVAL HANDOFF: YES

CONCURRENT MANAGER DECISIONS ARE SAFE: YES

PHASE 5 RETURNED RESUBMISSION REGRESSION PASSED: YES

FULL REGRESSION PASSED: YES

PRISMA SCHEMA CHANGED: NO

PRISMA MIGRATIONS CHANGED: NO

PHASE 7 STARTED: NO

BLOCKING DEFECTS REMAIN: NO

PHASE 6 READY FOR INDEPENDENT REVIEW: YES

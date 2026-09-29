<?php
/**
 * Reception room timeline controller.
 *
 * The planner reuses QloApps booking models and the existing order edit flow;
 * it does not duplicate price, tax, or service recalculation logic.
 */

class AdminHotelRoomTimelineController extends ModuleAdminController
{
    const DEFAULT_RANGE_DAYS = 14;
    const MAX_RANGE_DAYS = 31;

    public function __construct()
    {
        $this->bootstrap = true;
        $this->table = 'htl_booking_detail';
        $this->className = 'HotelBookingDetail';
        $this->lang = false;
        parent::__construct();

        $this->display = 'view';
        $this->base_tpl_view = 'room_timeline_view.tpl';
    }

    public function setMedia()
    {
        parent::setMedia();
        $this->addCSS($this->module->getPathUri().'views/css/admin/room_timeline.css');
        // Reuse the existing order-room editor for date, service and price updates.
        $this->addJS(_PS_JS_DIR_.'admin/orders.js');
        $this->addJS($this->module->getPathUri().'views/js/admin/room_timeline.js');
    }

    public function renderView()
    {
        $hotelInfo = new HotelBranchInformation();
        $hotels = $hotelInfo->hotelBranchesInfo(false, 1);
        $hotels = HotelBranchInformation::filterDataByHotelAccess(
            is_array($hotels) ? $hotels : array(),
            (int) $this->context->employee->id_profile,
            'id'
        );

        $selectedHotel = (int) Tools::getValue('id_hotel');
        $allowedHotelIds = array_map('intval', array_column($hotels, 'id'));
        if (!$selectedHotel || !in_array($selectedHotel, $allowedHotelIds)) {
            $selectedHotel = $allowedHotelIds ? (int) reset($allowedHotelIds) : 0;
        }

        $orderAccess = Profile::getProfileAccess(
            (int) $this->context->employee->id_profile,
            (int) Tab::getIdFromClassName('AdminOrders')
        );
        $canEditBookings = !empty($this->tabAccess['edit'])
            && is_array($orderAccess)
            && !empty($orderAccess['edit'])
            && (int) $orderAccess['edit'] === 1;

        $this->tpl_view_vars = array_merge($this->tpl_view_vars, array(
            'timeline_hotels' => $hotels,
            'timeline_selected_hotel' => $selectedHotel,
            'timeline_can_edit' => $canEditBookings,
            'timeline_ajax_url' => $this->context->link->getAdminLink('AdminHotelRoomTimeline'),
            'timeline_orders_url' => $this->context->link->getAdminLink('AdminOrders'),
            'timeline_orders_token' => Tools::getAdminTokenLite('AdminOrders'),
            'timeline_allow_backdate' => (bool) Configuration::get(
                $this->context->employee->isSuperAdmin() ? 'PS_BACKDATE_ORDER_SUPERADMIN' : 'PS_BACKDATE_ORDER_EMPLOYEES'
            ),
            'timeline_today' => date('Y-m-d'),
            'timeline_range_days' => self::DEFAULT_RANGE_DAYS,
        ));

        return parent::renderView();
    }

    public function ajaxProcessGetTimelineData()
    {
        $rawHotelId = Tools::getValue('id_hotel');
        $idHotel = is_scalar($rawHotelId) && Validate::isUnsignedId((string) $rawHotelId) ? (int) $rawHotelId : 0;
        $startDate = $this->parseIsoDate(Tools::getValue('start_date'));
        $rawDays = Tools::getValue('days', self::DEFAULT_RANGE_DAYS);
        $days = is_scalar($rawDays) && Validate::isUnsignedInt((string) $rawDays) ? (int) $rawDays : self::DEFAULT_RANGE_DAYS;

        if (!$startDate || !$this->employeeCanAccessHotel($idHotel)) {
            $this->sendJson(array('success' => false, 'error' => $this->l('Invalid hotel or date range.')));
        }
        $days = max(1, min(self::MAX_RANGE_DAYS, $days));
        $endDate = date('Y-m-d', strtotime('+'.$days.' days', strtotime($startDate)));

        $rooms = HotelRoomInformation::getHotelRoomsInfo($idHotel, 0, (int) $this->context->language->id);
        if (!is_array($rooms)) {
            $rooms = array();
        }
        $roomTypes = array();
        foreach ($rooms as &$room) {
            $room['id'] = (int) $room['id'];
            $room['id_product'] = (int) $room['id_product'];
            $room['id_status'] = (int) $room['id_status'];
            $roomTypes[$room['id_product']] = array(
                'id' => (int) $room['id_product'],
                'name' => $room['room_type_name'],
            );
        }
        unset($room);

        $refundedSubquery = OrderReturn::getRefundedBookingIdsSubquery();
        $sql = 'SELECT b.`id`, b.`id_order`, b.`id_order_detail`, b.`id_cart`, b.`id_customer`,
                    b.`id_hotel`, b.`id_product`, b.`id_room`, b.`id_status`, b.`booking_type`,
                    b.`room_type_name`, b.`date_from`, b.`date_to`, b.`check_in`, b.`check_out`,
                    IF(b.`id_status` = '.(int) HotelBookingDetail::STATUS_CHECKED_OUT.', b.`check_out`, b.`date_to`) AS `timeline_date_to`,
                    b.`adults`, b.`children`, b.`child_ages`, b.`total_price_tax_excl`,
                    b.`total_price_tax_incl`, b.`total_paid_amount`, b.`is_back_order`,
                    r.`room_num`, r.`id_status` AS `room_status`, r.`floor`,
                    rt.`max_adults`, rt.`max_children`, rt.`max_guests`,
                    o.`reference`, c.`firstname`, c.`lastname`, od.`unit_price_tax_excl`,
                    od.`unit_price_tax_incl`, od.`reduction_amount_tax_excl`,
                    od.`reduction_amount_tax_incl`,
                    IF(b.`id` IN ('.$refundedSubquery.'), 1, 0) AS `is_refunded`
                FROM `'._DB_PREFIX_.'htl_booking_detail` b
                INNER JOIN `'._DB_PREFIX_.'htl_room_information` r ON (r.`id` = b.`id_room`)
                LEFT JOIN `'._DB_PREFIX_.'htl_room_type` rt ON (rt.`id_product` = b.`id_product`)
                LEFT JOIN `'._DB_PREFIX_.'orders` o ON (o.`id_order` = b.`id_order`)
                LEFT JOIN `'._DB_PREFIX_.'customer` c ON (c.`id_customer` = b.`id_customer`)
                LEFT JOIN `'._DB_PREFIX_.'order_detail` od ON (od.`id_order_detail` = b.`id_order_detail`)
                WHERE b.`id_hotel` = '.(int) $idHotel.'
                    AND b.`date_from` < \''.pSQL($endDate).'\'
                    AND IF(b.`id_status` = '.(int) HotelBookingDetail::STATUS_CHECKED_OUT.', b.`check_out`, b.`date_to`) > \''.pSQL($startDate).'\'
                ORDER BY b.`id_room`, b.`date_from`, b.`id`';
        $rows = Db::getInstance()->executeS($sql);
        if (!is_array($rows)) {
            $rows = array();
        }

        $bookings = array();
        foreach ($rows as $row) {
            $nights = max(1, (int) HotelHelper::getNumberOfDays($row['date_from'], $row['date_to']));
            $orderDetailId = (int) $row['id_order_detail'];
            $paidUnitTaxExcl = (float) $row['total_price_tax_excl'] / $nights;
            $paidUnitTaxIncl = (float) $row['total_price_tax_incl'] / $nights;
            $childrenAges = json_decode($row['child_ages'], true);
            if (!is_array($childrenAges)) {
                $childrenAges = array();
            }

            $productLineData = array(
                'id' => (int) $row['id'],
                'id_order' => (int) $row['id_order'],
                'id_order_detail' => $orderDetailId,
                'id_product' => (int) $row['id_product'],
                'id_room' => (int) $row['id_room'],
                'id_hotel' => (int) $row['id_hotel'],
                'id_status' => (int) $row['id_status'],
                'is_refunded' => (bool) $row['is_refunded'],
                'date_from' => substr($row['date_from'], 0, 10),
                'date_to' => substr($row['date_to'], 0, 10),
                'adults' => (int) $row['adults'],
                'children' => (int) $row['children'],
                'child_ages' => $childrenAges,
                'paid_unit_price_tax_excl' => $paidUnitTaxExcl,
                'paid_unit_price_tax_incl' => $paidUnitTaxIncl,
                'original_unit_price_tax_excl' => (float) $row['unit_price_tax_excl'],
                'original_unit_price_tax_incl' => (float) $row['unit_price_tax_incl'],
                'unit_price_without_reduction_tax_excl' => (float) $row['unit_price_tax_excl'] + (float) $row['reduction_amount_tax_excl'],
                'unit_price_without_reduction_tax_incl' => (float) $row['unit_price_tax_incl'] + (float) $row['reduction_amount_tax_incl'],
                'room_type_info' => array(
                    'max_adults' => (int) $row['max_adults'],
                    'max_children' => (int) $row['max_children'],
                    'max_guests' => (int) $row['max_guests'],
                ),
            );

            $bookings[] = array(
                'id' => (int) $row['id'],
                'id_order' => (int) $row['id_order'],
                'id_order_detail' => $orderDetailId,
                'id_product' => (int) $row['id_product'],
                'id_room' => (int) $row['id_room'],
                'id_hotel' => (int) $row['id_hotel'],
                'room_num' => $row['room_num'],
                'room_type_name' => $row['room_type_name'],
                'customer_name' => trim($row['firstname'].' '.$row['lastname']),
                'order_reference' => $row['reference'],
                'date_from' => substr($row['date_from'], 0, 10),
                'date_to' => substr($row['timeline_date_to'], 0, 10),
                'id_status' => (int) $row['id_status'],
                'is_refunded' => (bool) $row['is_refunded'],
                'is_back_order' => (bool) $row['is_back_order'],
                'editable' => $this->canEditBookings() && $orderDetailId > 0,
                'product_line_data' => $productLineData,
            );
        }

        $this->sendJson(array(
            'success' => true,
            'start_date' => $startDate,
            'days' => $days,
            'rooms' => array_values($rooms),
            'room_types' => array_values($roomTypes),
            'bookings' => $bookings,
        ));
    }

    public function ajaxProcessReallocateRoom()
    {
        if (!$this->canEditBookings()) {
            $this->sendJson(array('success' => false, 'error' => $this->l('You do not have permission to edit bookings.')));
        }

        $rawBookingId = Tools::getValue('id_booking');
        $rawRoomId = Tools::getValue('id_room');
        $idBooking = is_scalar($rawBookingId) && Validate::isUnsignedId((string) $rawBookingId) ? (int) $rawBookingId : 0;
        $idRoom = is_scalar($rawRoomId) && Validate::isUnsignedId((string) $rawRoomId) ? (int) $rawRoomId : 0;
        $booking = new HotelBookingDetail($idBooking);
        $room = new HotelRoomInformation($idRoom);

        if (!Validate::isLoadedObject($booking) || !Validate::isLoadedObject($room)
            || !$this->employeeCanAccessHotel((int) $booking->id_hotel)
            || (int) $booking->id_status !== HotelBookingDetail::STATUS_ASSIGNED
            || (int) $booking->id_hotel !== (int) $room->id_hotel
            || (int) $booking->id_product !== (int) $room->id_product
            || (int) $booking->id_room === (int) $room->id
            || (int) $room->id_status !== HotelRoomInformation::STATUS_ACTIVE
            || $booking->is_back_order
            || $this->bookingIsRefunded($idBooking)
        ) {
            $this->sendJson(array('success' => false, 'error' => $this->l('This booking cannot be moved to the selected room.')));
        }

        $db = Db::getInstance();
        if (!$db->execute('START TRANSACTION')) {
            $this->sendJson(array('success' => false, 'error' => $this->l('Unable to start the booking update.')));
        }

        // Serialize planner moves targeting the same room, then check availability
        // directly on the primary connection so the check participates in the transaction.
        $lockedRoom = $db->getRow(
            'SELECT `id`, `id_hotel`, `id_product`, `id_status` FROM `'._DB_PREFIX_.'htl_room_information`
            WHERE `id` = '.(int) $idRoom.' FOR UPDATE',
            false
        );
        if (!$lockedRoom
            || (int) $lockedRoom['id_hotel'] !== (int) $booking->id_hotel
            || (int) $lockedRoom['id_product'] !== (int) $booking->id_product
            || (int) $lockedRoom['id_status'] !== HotelRoomInformation::STATUS_ACTIVE
        ) {
            $db->execute('ROLLBACK');
            $this->sendJson(array('success' => false, 'error' => $this->l('The selected room is no longer a valid target.')));
        }

        $refundedSubquery = OrderReturn::getRefundedBookingIdsSubquery();
        $conflict = $db->getValue(
            'SELECT `id` FROM `'._DB_PREFIX_.'htl_booking_detail`
            WHERE `id_room` = '.(int) $idRoom.'
                AND `id` != '.(int) $idBooking.'
                AND `is_back_order` = 0
                AND `id` NOT IN ('.$refundedSubquery.')
                AND `date_from` < \''.pSQL($booking->date_to).'\'
                AND IF(`id_status` = '.(int) HotelBookingDetail::STATUS_CHECKED_OUT.', `check_out`, `date_to`) > \''.pSQL($booking->date_from).'\'
            LIMIT 1',
            false
        );
        $disabled = $db->getValue(
            'SELECT `id` FROM `'._DB_PREFIX_.'htl_room_disable_dates`
            WHERE `id_room` = '.(int) $idRoom.'
                AND `date_from` < \''.pSQL($booking->date_to).'\'
                AND `date_to` > \''.pSQL($booking->date_from).'\'
            LIMIT 1',
            false
        );
        if ($conflict || $disabled) {
            $db->execute('ROLLBACK');
            $error = $conflict
                ? $this->l('The selected room is no longer available for these dates.')
                : $this->l('The selected room is blocked for maintenance during these dates.');
            $this->sendJson(array('success' => false, 'error' => $error));
        }

        $bookingManager = new HotelBookingDetail();
        $movedBookingId = $bookingManager->reallocateBooking($idBooking, $idRoom);
        if (!$movedBookingId) {
            $db->execute('ROLLBACK');
            $this->sendJson(array('success' => false, 'error' => $this->l('The booking could not be moved.')));
        }

        $db->execute('COMMIT');
        $this->sendJson(array('success' => true, 'id_booking' => (int) $movedBookingId));
    }

    public function ajaxProcessPreviewStayChange()
    {
        if (!$this->canEditBookings()) {
            $this->sendJson(array('success' => false, 'error' => $this->l('You do not have permission to edit bookings.')));
        }

        $rawBookingId = Tools::getValue('id_booking');
        $idBooking = is_scalar($rawBookingId) && Validate::isUnsignedId((string) $rawBookingId) ? (int) $rawBookingId : 0;
        $booking = new HotelBookingDetail($idBooking);
        $rawTargetRoomId = Tools::getValue('target_room_id');
        $targetRoomId = is_scalar($rawTargetRoomId) && Validate::isUnsignedId((string) $rawTargetRoomId)
            ? (int) $rawTargetRoomId
            : (int) $booking->id_room;
        $dateFrom = $this->parseIsoDate(Tools::getValue('date_from'));
        $dateTo = $this->parseIsoDate(Tools::getValue('date_to'));
        $rawUnitPrice = Tools::getValue('unit_price_tax_excl', '');
        $unitPrice = is_scalar($rawUnitPrice) ? str_replace(',', '.', (string) $rawUnitPrice) : '';

        if (!Validate::isLoadedObject($booking)
            || !$this->employeeCanAccessHotel((int) $booking->id_hotel)
            || !$dateFrom
            || !$dateTo
            || strtotime($dateTo) <= strtotime($dateFrom)
            || !Validate::isPrice($unitPrice)
        ) {
            $this->sendJson(array('success' => false, 'error' => $this->l('Enter a valid stay period and room price.')));
        }

        if ((int) $booking->id_status !== HotelBookingDetail::STATUS_ASSIGNED
            && $dateFrom !== substr($booking->date_from, 0, 10)
        ) {
            $this->sendJson(array('success' => false, 'error' => $this->l('The check-in date cannot be changed after check-in.')));
        }
        if ((int) $booking->id_status === HotelBookingDetail::STATUS_CHECKED_OUT
            && $dateTo !== substr($booking->date_to, 0, 10)
        ) {
            $this->sendJson(array('success' => false, 'error' => $this->l('The check-out date cannot be changed after check-out.')));
        }
        if ($this->bookingIsRefunded($idBooking)) {
            $this->sendJson(array('success' => false, 'error' => $this->l('Dates cannot be changed for a fully refunded booking.')));
        }

        $room = new HotelRoomInformation((int) $booking->id_room);
        if (!Validate::isLoadedObject($room)) {
            $this->sendJson(array('success' => false, 'error' => $this->l('The assigned room could not be loaded.')));
        }
        $targetRoom = $targetRoomId === (int) $booking->id_room
            ? $room
            : new HotelRoomInformation($targetRoomId);
        if (!Validate::isLoadedObject($targetRoom)
            || (int) $targetRoom->id_hotel !== (int) $booking->id_hotel
            || (int) $targetRoom->id_product !== (int) $booking->id_product
            || ($targetRoomId !== (int) $booking->id_room
                && (int) $targetRoom->id_status !== HotelRoomInformation::STATUS_ACTIVE)
        ) {
            $this->sendJson(array('success' => false, 'error' => $this->l('The selected room is not a valid destination for this booking.')));
        }

        $startDateTime = $dateFrom.' 00:00:00';
        $endDateTime = $dateTo.' 00:00:00';
        $refundedSubquery = OrderReturn::getRefundedBookingIdsSubquery();
        $conflict = Db::getInstance()->getValue(
            'SELECT b.`id` FROM `'._DB_PREFIX_.'htl_booking_detail` b
            WHERE b.`id_room` = '.(int) $booking->id_room.'
                AND b.`id` != '.(int) $idBooking.'
                AND b.`is_back_order` = 0
                AND b.`id` NOT IN ('.$refundedSubquery.')
                AND b.`date_from` < \''.pSQL($endDateTime).'\'
                AND IF(b.`id_status` = '.(int) HotelBookingDetail::STATUS_CHECKED_OUT.', b.`check_out`, b.`date_to`) > \''.pSQL($startDateTime).'\'
            LIMIT 1'
        );
        if ($conflict) {
            $this->sendJson(array('success' => false, 'error' => $this->l('This room is already occupied during part of the selected stay.')));
        }

        $disabled = Db::getInstance()->getValue(
            'SELECT `id` FROM `'._DB_PREFIX_.'htl_room_disable_dates`
            WHERE `id_room` = '.(int) $booking->id_room.'
                AND `date_from` < \''.pSQL($endDateTime).'\'
                AND `date_to` > \''.pSQL($startDateTime).'\'
            LIMIT 1'
        );
        if ($disabled) {
            $this->sendJson(array('success' => false, 'error' => $this->l('The room is blocked for maintenance during part of the selected stay.')));
        }
        if ($targetRoomId !== (int) $booking->id_room) {
            $targetConflict = Db::getInstance()->getValue(
                'SELECT b.`id` FROM `'._DB_PREFIX_.'htl_booking_detail` b
                WHERE b.`id_room` = '.(int) $targetRoomId.'
                    AND b.`id` != '.(int) $idBooking.'
                    AND b.`is_back_order` = 0
                    AND b.`id` NOT IN ('.$refundedSubquery.')
                    AND b.`date_from` < \''.pSQL($endDateTime).'\'
                    AND IF(b.`id_status` = '.(int) HotelBookingDetail::STATUS_CHECKED_OUT.', b.`check_out`, b.`date_to`) > \''.pSQL($startDateTime).'\'
                LIMIT 1',
                false
            );
            if ($targetConflict) {
                $this->sendJson(array('success' => false, 'error' => $this->l('The destination room is already occupied during part of the selected stay.')));
            }
            $targetDisabled = Db::getInstance()->getValue(
                'SELECT `id` FROM `'._DB_PREFIX_.'htl_room_disable_dates`
                WHERE `id_room` = '.(int) $targetRoomId.'
                    AND `date_from` < \''.pSQL($endDateTime).'\'
                    AND `date_to` > \''.pSQL($startDateTime).'\'
                LIMIT 1',
                false
            );
            if ($targetDisabled) {
                $this->sendJson(array('success' => false, 'error' => $this->l('The destination room is blocked for maintenance during part of the selected stay.')));
            }
        }

        $nights = max(1, (int) HotelHelper::getNumberOfDays($startDateTime, $endDateTime));
        $order = new Order((int) $booking->id_order);
        $orderDetail = new OrderDetail((int) $booking->id_order_detail);
        if (!Validate::isLoadedObject($order) || !Validate::isLoadedObject($orderDetail)) {
            $this->sendJson(array('success' => false, 'error' => $this->l('The related order details could not be loaded.')));
        }

        $oldTotalTaxExcl = (float) $booking->total_price_tax_excl;
        $oldTotalTaxIncl = (float) $booking->total_price_tax_incl;
        $unitPriceTaxExcl = (float) $unitPrice;
        $newTotalTaxExcl = 0;
        $newTotalTaxIncl = 0;
        $product = new Product((int) $booking->id_product);
        $cart = new Cart((int) $booking->id_cart);
        $this->context->currency = new Currency((int) $order->id_currency);
        $this->context->cart = $cart;
        $this->context->customer = new Customer((int) $order->id_customer);
        if (Validate::isLoadedObject($product)) {
            // Match the existing AdminOrders save flow: apply the entered unit price
            // for this stay, then ask the room pricing engine to price each night.
            $db = Db::getInstance();
            if (!$db->execute('START TRANSACTION')) {
                $this->sendJson(array('success' => false, 'error' => $this->l('The price estimate could not be calculated.')));
            }
            $temporaryPriceId = 0;
            try {
                $temporaryPriceId = HotelRoomTypeFeaturePricing::createRoomTypeFeaturePrice(array(
                    'id_cart' => (int) $cart->id,
                    'id_guest' => (int) $cart->id_guest,
                    'id_product' => (int) $booking->id_product,
                    'id_room' => (int) $booking->id_room,
                    'impact_value' => $unitPriceTaxExcl,
                    'restrictions' => array(array(
                        'date_from' => $startDateTime,
                        'date_to' => $endDateTime,
                    )),
                ));
                $roomPrice = HotelRoomTypeFeaturePricing::getRoomTypeTotalPrice(
                    (int) $booking->id_product,
                    $startDateTime,
                    $endDateTime,
                    0,
                    (int) Group::getCurrent()->id,
                    (int) $cart->id,
                    (int) $cart->id_guest,
                    (int) $booking->id_room,
                    0,
                    1
                );
                $newTotalTaxExcl = (float) $roomPrice['total_price_tax_excl'];
                $newTotalTaxIncl = (float) $roomPrice['total_price_tax_incl'];
            } finally {
                if ($temporaryPriceId) {
                    $temporaryPrice = new HotelRoomTypeFeaturePricing((int) $temporaryPriceId);
                    if (Validate::isLoadedObject($temporaryPrice)) {
                        $temporaryPrice->delete();
                    }
                }
                $db->execute('ROLLBACK');
            }
        } else {
            // Keep legacy bookings with deleted room types editable, as in AdminOrders.
            $taxCalculator = $orderDetail->getTaxCalculator();
            $unitPriceTaxIncl = $taxCalculator ? (float) $taxCalculator->addTaxes($unitPriceTaxExcl) : $unitPriceTaxExcl;
            $newTotalTaxExcl = Tools::processPriceRounding($unitPriceTaxExcl, $nights, $order->round_type, $order->round_mode);
            $newTotalTaxIncl = Tools::processPriceRounding($unitPriceTaxIncl, $nights, $order->round_type, $order->round_mode);
        }

        $serviceDetails = (new ServiceProductOrderDetail())->getRoomTypeServiceProducts(
            (int) $booking->id_order,
            0,
            0,
            0,
            $booking->date_from,
            $booking->date_to,
            (int) $booking->id_room,
            0,
            null,
            null,
            null,
            0,
            $idBooking
        );
        $services = isset($serviceDetails[$idBooking]['additional_services'])
            ? $serviceDetails[$idBooking]['additional_services']
            : array();
        foreach ($services as $service) {
            $oldTotalTaxExcl += (float) $service['total_price_tax_excl'];
            $oldTotalTaxIncl += (float) $service['total_price_tax_incl'];
            if ((int) $service['price_calculation_method'] === Product::PRICE_CALCULATION_METHOD_PER_DAY) {
                $newTotalTaxExcl += Tools::processPriceRounding(
                    ((float) $service['unit_price_tax_excl'] * $nights),
                    (int) $service['quantity'],
                    $order->round_type,
                    $order->round_mode
                );
                $newTotalTaxIncl += Tools::processPriceRounding(
                    ((float) $service['unit_price_tax_incl'] * $nights),
                    (int) $service['quantity'],
                    $order->round_type,
                    $order->round_mode
                );
            } else {
                $newTotalTaxExcl += (float) $service['total_price_tax_excl'];
                $newTotalTaxIncl += (float) $service['total_price_tax_incl'];
            }
        }

        $currency = new Currency((int) $order->id_currency);
        $this->sendJson(array(
            'success' => true,
            'nights' => $nights,
            'old_total_tax_excl' => $oldTotalTaxExcl,
            'old_total_tax_incl' => $oldTotalTaxIncl,
            'new_total_tax_excl' => $newTotalTaxExcl,
            'new_total_tax_incl' => $newTotalTaxIncl,
            'difference_tax_incl' => $newTotalTaxIncl - $oldTotalTaxIncl,
            'old_total' => Tools::displayPrice($oldTotalTaxIncl, $currency),
            'new_total' => Tools::displayPrice($newTotalTaxIncl, $currency),
            'difference' => Tools::displayPrice($newTotalTaxIncl - $oldTotalTaxIncl, $currency),
        ));
    }

    protected function canEditBookings()
    {
        $orderAccess = Profile::getProfileAccess(
            (int) $this->context->employee->id_profile,
            (int) Tab::getIdFromClassName('AdminOrders')
        );

        return !empty($this->tabAccess['edit'])
            && is_array($orderAccess)
            && !empty($orderAccess['edit'])
            && (int) $orderAccess['edit'] === 1;
    }

    protected function employeeCanAccessHotel($idHotel)
    {
        if (!$idHotel) {
            return false;
        }
        $hotels = (new HotelBranchInformation())->hotelBranchesInfo(false, 1);
        $hotels = HotelBranchInformation::filterDataByHotelAccess(
            is_array($hotels) ? $hotels : array(),
            (int) $this->context->employee->id_profile,
            'id'
        );
        return in_array((int) $idHotel, array_map('intval', array_column($hotels, 'id')));
    }

    protected function bookingIsRefunded($idBooking)
    {
        $subquery = OrderReturn::getRefundedBookingIdsSubquery();
        return (bool) Db::getInstance()->getValue(
            'SELECT `id` FROM `'._DB_PREFIX_.'htl_booking_detail`
            WHERE `id` = '.(int) $idBooking.' AND `id` IN ('.$subquery.')'
        );
    }

    protected function parseIsoDate($value)
    {
        if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
            return false;
        }
        $date = DateTime::createFromFormat('!Y-m-d', $value);
        return $date && $date->format('Y-m-d') === $value ? $value : false;
    }

    protected function sendJson($payload)
    {
        header('Content-Type: application/json; charset=utf-8');
        $this->ajaxDie(Tools::jsonEncode($payload));
    }
}

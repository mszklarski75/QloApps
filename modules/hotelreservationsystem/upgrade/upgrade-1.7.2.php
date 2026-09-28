<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

/**
 * Add the reception room planner tab to existing installations.
 *
 * @param Module $module
 * @return bool
 */
function upgrade_module_1_7_2($module)
{
    $idTab = (int) Tab::getIdFromClassName('AdminHotelRoomTimeline');
    if (!$idTab) {
        return $module->installTab(
            'AdminHotelRoomTimeline',
            'Room Planner',
            'AdminHotelReservationSystemManagement'
        );
    }

    $tab = new Tab($idTab);
    $tab->active = 1;
    $tab->module = $module->name;
    $tab->id_parent = (int) Tab::getIdFromClassName('AdminHotelReservationSystemManagement');
    foreach (Language::getLanguages(true) as $language) {
        $tab->name[(int) $language['id_lang']] = 'Room Planner';
    }

    return (bool) $tab->update();
}

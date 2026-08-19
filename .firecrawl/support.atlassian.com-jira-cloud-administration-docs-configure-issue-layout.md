[Skip to main content](https://support.atlassian.com/jira-cloud-administration/docs/configure-issue-layout/#maincontent)

# Configure the layout of the work item

You can set the visibility and order of fields for a space's work types. These fields will show up in the order you’ve set in the work item. The fields available to you for each work type are defined in the global screen configuration for viewing the work type. As a Jira admin, you can add or remove fields for a work type.

You must either be a Jira or space admin to configure the layout of the work item. [More about](https://support.atlassian.com/jira-cloud-administration/docs/manage-project-roles/ "https://support.atlassian.com/jira-cloud-administration/docs/manage-project-roles/") space [roles in company-managed](https://support.atlassian.com/jira-cloud-administration/docs/manage-project-roles/ "https://support.atlassian.com/jira-cloud-administration/docs/manage-project-roles/") spaces.

## What is the layout of a work item?

Choosing which fields appear on your team's work items, and which of those are most important, can help your team get more done in less time. If there are a few fields you fill out for _every_ bug, for example, it makes sense that those fields are always visible and probably somewhere towards the top of the work item If you're a space administrator, you can set up the work item for your space in the way that works best for your team.

Layout settings are for individual spaces. You can't share layout settings between spaces right now.

In the layout of the work item, you’ll see a list of fields in a few different categories: description fields, context fields, hide when empty fields, and hidden fields. Here’s how fields in each of these categories appear when viewing a work item’s details:

![Image that shows fields in the issue view.](https://images.ctfassets.net/zsv3d0ugroxu/LyyXjaMUHLF9ukzd9hcM6/e5a9aafb18c8d8129c1f0584c3f5ec3c/image-20250224-210422__1_.png)

1. **Description fields**: Since this section is the first place users look when they open a work item, your most important fields should be configured here.

2. **Field tabs**: If the layout's screen is configured with more than one tab, they'll show up here.

3. **Context fields**: Fields above the _hide when empty_ line in configuration appear here in the _Details_ group. Each user can pin their most important context fields into the _Pinned fields_ group depending on what works for them.

4. **More fields**: Fields under _hide when empty_ are placed in this group when they don't have a value. When they have a value, they'll appear in the _Details_ group.

5. **Configure layout of the work item**: Click _Configure_ to change the position and visibility of fields in the work item. [Find out about configuring the field layout in the work item](https://support.atlassian.com/jira-software-cloud/docs/configure-field-layout-in-the-issue-view/ "https://support.atlassian.com/jira-software-cloud/docs/configure-field-layout-in-the-issue-view/").


## Fields in the layout of a work item

You can drag and drop fields into different sections when you configure the layout of a work item.

Your Jira admin creates fields across your Jira site. And, they make those fields available to space admins through Jira's admin settings and space configuration schemes. [More about how Jira admins create fields](https://support.atlassian.com/jira-cloud-administration/docs/create-a-custom-field/ "https://support.atlassian.com/jira-cloud-administration/docs/create-a-custom-field/").

Space admins can configure how these fields look in their spaces by setting up their layout.

**Description fields**

This section usually appears on the left side of the work item (or at the top in a single-column layout). Since this is the first place users look when they open a work item, put your most important fields here. If your layout's screen is configured with more than one tab, the other tabs will appear in this section. Only Jira admins can configure tabs (space admins can't change the order of the fields displayed in the tab). [More about configuring a screen's tabs and fields](https://support.atlassian.com/jira-cloud-administration/docs/manage-issue-screens/#Definingascreen-configureConfiguringascreen%27stabsandfields "https://support.atlassian.com/jira-cloud-administration/docs/manage-issue-screens/#Definingascreen-configureConfiguringascreen%27stabsandfields").

**Context fields**

This section normally appears down the right side of the work item (or at the bottom in a single-column layout) in the **Details** and **More fields** groups. Context fields usually contain secondary information that your team might need to sort, filter, or report on work items. Each user can customize context fields to work for them by pinning their most used ones to the top of a work item in the **Pinned fields** group. [More about pinning fields](https://support.atlassian.com/jira-core-cloud/docs/pin-a-field-to-the-top-of-an-issue/ "https://support.atlassian.com/jira-core-cloud/docs/pin-a-field-to-the-top-of-an-issue/").

**Hide when empty**

The context fields section has a divider you can use to sort always-important fields from _sometimes_-important ones. Fields above the _hide when empty_ are shown in the **Details** group and those below the line are hidden under the **More fields** group when they don't have a value. When a field in the **More fields** group has a value, it moves to the **Details** group.

**Fields**

This section is for fields that you don't want to appear on the work item _at all_. Use the search bar in this section to find and add fields to the work item. To add fields, use the search bar in this section and drag them into the Description or Context field sections.

To remove fields from the layout of the work item, you can drag fields to this section or in the field more menu select **Remove field**.

## Customize the layout of the work item

Customizing the fields that appear on your team’s work items can help your team resolve requests faster. For example, if there are a few fields that need to be filled out for every work item, then it makes sense for those fields to be visible and somewhere towards the top of the work item.

Each space has its own layout. You can’t share layout settings between spaces right now. See how to [add fields that don't appear in the layout screen](https://support.atlassian.com/jira-cloud-administration/docs/specify-field-behavior/ "https://support.atlassian.com/jira-cloud-administration/docs/specify-field-behavior/").

You must either be a Jira or space admin to configure the layout of the work item. [More about space roles in company-managed spaces](https://support.atlassian.com/jira-cloud-administration/docs/manage-project-roles/ "https://support.atlassian.com/jira-cloud-administration/docs/manage-project-roles/").

To view or edit the layout of your space’s work types:

1. Next to the name of your space in the sidebar, select **More actions** (•••), then **Space** **settings**.

2. Select **Work items**, then **Layout**.

3. Find the work type(s) whose layout you want to view and select **Edit work item layout**. You’ll see the work item layout for a screen that is configured for the space. [Find out more about screens](https://support.atlassian.com/jira-cloud-administration/docs/manage-issue-screens/ "https://support.atlassian.com/jira-cloud-administration/docs/manage-issue-screens/").

4. Drag and drop fields to move them to a different section. Fields in the hidden section won’t be visible in the work item, but will still be connected to the work type(s).

5. Select **Save changes**.


Select a work item in the space you’ve set up the layout for. The fields you’ve configured in the layout of the work item for the space will show up in different sections in the work item. [More about work items](https://support.atlassian.com/jira-work-management/docs/what-is-the-new-jira-issue-view/ "https://support.atlassian.com/jira-work-management/docs/what-is-the-new-jira-issue-view/").

If a group of work types—tasks and subtasks, for example—use the same [view work item screen](https://confluence.atlassian.com/adminjiracloud/associating-a-screen-with-an-issue-operation-776636488.html "https://confluence.atlassian.com/adminjiracloud/associating-a-screen-with-an-issue-operation-776636488.html"), which they do by default, you'll configure the fields for those work types all together as a set.

## Reuse fields in the layout of the work item

You can reuse fields from other work types and spaces and won’t have to create these fields for every space. Search for fields that were recently created and/or used in other work types and spaces and use the fields in the current space.

You can only reuse fields with global contexts. Find out about global contexts.

To search for and reuse fields:

1. Next to the name of your space in the sidebar, select **More actions** (•••), then **Space** **settings**.

2. Select **Work items**, then **Layout**.

3. Find the work type(s) whose layout you want to view and select **Edit work item layout**. You’ll see the work item layout for a screen that is configured for the space. [More about screens](https://support.atlassian.com/jira-cloud-administration/docs/manage-issue-screens/ "https://support.atlassian.com/jira-cloud-administration/docs/manage-issue-screens/").

4. Search for fields using the search bar on the right under **Fields**. Alternatively, select a field from **Suggested fields**, which contains a list of all work items that were recently created, or are used in other work types of the space.

5. Drag and drop fields to move them to a section on the left.

6. Select **Save changes**.


After you’ve dragged a field to one of the sections on the left, you can go to [field configuration](https://support.atlassian.com/jira-cloud-administration/docs/manage-issue-field-configurations/ "https://support.atlassian.com/jira-cloud-administration/docs/manage-issue-field-configurations/") from the layout of the work item.

Was this helpful?

Yes

No

It wasn't accurateIt wasn't clearIt wasn't relevant

Provide feedback about this article

## Still need help?

The Atlassian Community is here for you.

[Ask the Community](https://community.atlassian.com/t5/custom/page/page-id/create-post-step-1?add-tags=jira-cloud-administration,Not%20Applicable)
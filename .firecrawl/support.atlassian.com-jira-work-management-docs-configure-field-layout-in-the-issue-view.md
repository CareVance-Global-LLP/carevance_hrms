[Skip to main content](https://support.atlassian.com/jira-software-cloud/docs/configure-field-layout-in-the-work-item/#maincontent)

[Cloud](https://support.atlassian.com/jira-software-cloud)

Data Center

# Configure field layout in the work item

We're rolling out some changes to the work item as an open beta. Some documentation may not yet reflect these updates, and the new experience might not be enabled on your site. [Read more about the upcoming changes](https://community.atlassian.com/forums/Jira-articles/A-clearer-more-focused-Jira-work-item-view-is-coming/ba-p/3262002 "https://community.atlassian.com/forums/Jira-articles/A-clearer-more-focused-Jira-work-item-view-is-coming/ba-p/3262002")

Choosing which fields appear on your team's work item, and which of those fields are most important, can help your team get more done in less time. The work item design enables great flexibility in where you place your fields. If there are a few fields you fill out for _every_ bug, for example, it makes sense that those fields are always visible and somewhere near the top of the work item. Space admins can set up the work item for spaces to work best with their team.

Work item layout settings are for individual spaces. You can't share layout settings between spaces right now. But you can copy a work item layout to other spaces that use the same screen. [Read more about copying a work item layout to other spaces](https://support.atlassian.com/jira-software-cloud/docs/copy-an-issue-layout-to-other-projects/ "https://support.atlassian.com/jira-software-cloud/docs/copy-an-issue-layout-to-other-projects/").

Your Jira admin creates fields across your Jira site. And, they make those fields available to space admins through Jira's administration settings and space configuration schemes. [Read more about how Jira admins create fields](https://support.atlassian.com/jira-cloud-administration/docs/create-a-custom-field/ "https://support.atlassian.com/jira-cloud-administration/docs/create-a-custom-field/").

Space admins can configure how these fields look in their spaces by setting up their layout. When configuring the layout, there are three sections: _description_ fields, _context_ fields, and _hidden_ fields.

## Description fields

This section usually appears on the left side of the work item (or at the top in a single-column layout). Since this is the first place users look when they open a work item, put your most important fields here. If your layout's screen is configured with more than one tab, the other tabs will appear in this section. Only Jira admins can configure tabs (space admins can't change the order of the fields displayed in the tab). [Read more about configuring a screen's tabs and fields](https://support.atlassian.com/jira-cloud-administration/docs/manage-issue-screens/#Definingascreen-configureConfiguringascreen%27stabsandfields "https://support.atlassian.com/jira-cloud-administration/docs/manage-issue-screens/#Definingascreen-configureConfiguringascreen%27stabsandfields").

## Context fields

This section normally appears down the right side of the work item (or at the bottom in a single-column layout) in the **Details** and **More fields** groups. Context fields usually contain secondary information that your team might need to sort, filter, or report on work items. Each user can customize context fields to work for them by pinning their most used ones to the top of a work item in the **Pinned fields** group. [Read more about pinning fields](https://support.atlassian.com/jira-core-cloud/docs/pin-a-field-to-the-top-of-an-issue/ "https://support.atlassian.com/jira-core-cloud/docs/pin-a-field-to-the-top-of-an-issue/").

### Hide when empty

The context fields section has a divider you can use to sort always-important fields from _sometimes_-important ones. Fields above the _hide when empty_ are shown in the **Details** group and those below the line are hidden under the **More fields** group when they don't have a value. When a field in the **More fields** group has a value, it moves to the **Details** group.

## Hidden fields

This section is for fields that you don't want to appear on the work item at all. When configuring the layout for a work item type, drag fields to the right side of the screen and drop them in the _Hidden fields_ section.

## Configure field layout

1. Open a work item. From the sidebar, select **Configure** (), then **Work item view**.

2. Add, remove, and drag fields in the field categories until you're happy with the setup.

3. Choose **Save changes**.


If a group of work types — tasks and subtasks, for example — use the same view work item screen, which they do by default, you'll configure the fields for those work types all together as a set.

[More about configuring screen schemes for work types](https://support.atlassian.com/jira-cloud-administration/docs/manage-issue-type-screens/ "https://support.atlassian.com/jira-cloud-administration/docs/manage-issue-type-screens/")

## Add fields and create field tabs

Only site admins can do the things described in this section.

The available fields for a work item type are the ones added in the global screen configuration for viewing that work type. To add more existing fields to a work item type, or create and manage field tabs, you need to visit that global configuration screen. [More about configuring screens](https://support.atlassian.com/jira-cloud-administration/docs/configure-issue-screens/ "https://support.atlassian.com/jira-cloud-administration/docs/configure-issue-screens/")

1. Open a work item. From the sidebar, select **Configure** (), then **Work item view**.

2. Select the link to the appropriate screen configuration at the top of the page. (If there are existing tabs in the configuration, you can also select the tab name and then **Edit fields & tabs**).

3. Add (or remove) the desired fields.

4. Add, remove, and edit the field tabs.


Once you have tabs configured, they'll appear in the description section on the left side of a work item. Select the tab to see its fields.

You can easily add new fields.Open a work item. From the **Details** section, select **Edit fields** (), then **Create fields**.

Was this helpful?

Yes

No

It wasn't accurateIt wasn't clearIt wasn't relevant

Provide feedback about this article

## Still need help?

The Atlassian Community is here for you.

[Ask the Community](https://community.atlassian.com/t5/custom/page/page-id/create-post-step-1?add-tags=jira-software,Cloud)